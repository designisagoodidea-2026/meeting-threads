import qs from '../../scripts/jev/questions.json'
import { finalScan } from './redact'

// The only place the key is used (spec 007 contracts/jev-proxy.md). Runs in the dev server, never in
// the browser; `fetch`, the environment, logging and sleep are passed in so tests can stand in for them.

type Env = { TYPESAFE_API_KEY?: string; JEV_ENABLED?: string }
type Reply = { status: number; body: unknown }
type Item = { turn_id: string; meeting: string; attendees: string[]; speaker: string; earlier_turns: string[]; turn: string }

const URL = 'https://api.typesafe.ai/v1/systemone'
const ITEM_KEYS = ['turn_id', 'meeting', 'attendees', 'speaker', 'earlier_turns', 'turn']
const TOP_KEYS = ['question_set', 'items']
const MAX_ITEMS = 200
const MAX_CHARS = 4000
const IN_FLIGHT = 4
const TRIES = 5

export function handleStatus(env: Env): Reply {
  if (!env.TYPESAFE_API_KEY) return { status: 200, body: { available: false, reason: 'no-key' } }
  if (env.JEV_ENABLED === '0') return { status: 200, body: { available: false, reason: 'disabled' } }
  return { status: 200, body: { available: true, model: qs.model, question_set: qs.question_set } }
}

const isStr = (v: unknown) => typeof v === 'string' && v.length <= MAX_CHARS
const isStrs = (v: unknown) => Array.isArray(v) && v.every(isStr)
const exactKeys = (o: object, keys: string[]) => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o)

function invalid(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'expected a JSON object'
  const b = body as Record<string, unknown>
  if (!exactKeys(b, TOP_KEYS)) return 'expected exactly question_set and items'
  if (b.question_set !== qs.question_set) return `unknown question_set`
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_ITEMS) return `items must hold 1 to ${MAX_ITEMS} entries`
  for (const it of b.items) {
    if (!it || typeof it !== 'object' || !exactKeys(it, ITEM_KEYS)) return `each item needs exactly ${ITEM_KEYS.join(', ')}`
    const i = it as Record<string, unknown>
    if (![i.turn_id, i.meeting, i.speaker, i.turn].every(isStr) || !isStrs(i.attendees) || !isStrs(i.earlier_turns)) return `strings must be at most ${MAX_CHARS} characters`
  }
  return null
}

// Every string in an item, for the scans here and in the browser.
export const itemText = (i: Omit<Item, 'turn_id'>) => [i.meeting, i.speaker, ...i.attendees, ...i.earlier_turns, i.turn].join('\n')

const criteria = (names: string[]) => Object.fromEntries(names.map((n) => [n, qs.questions.owner.criterion.replace('{name}', n)]))
const questionsFor = (attendees: string[]) => ({
  commitment: { type: 'noul', instructions: qs.questions.commitment.instructions },
  owner_a: { type: 'choice', instructions: qs.questions.owner.instructions, criteria: criteria(attendees) },
  owner_b: { type: 'choice', instructions: qs.questions.owner.instructions, criteria: criteria([...attendees].reverse()) },
})

// The same hash in the browser and here, so a saved answer can be matched to the text it was given (R8).
export async function stateHash(state: Omit<Item, 'turn_id'>) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const owner = (a: { choice?: unknown; confidence?: unknown } | undefined) =>
  a && typeof a.choice === 'string' && typeof a.confidence === 'number' ? { choice: a.choice, confidence: a.confidence } : null

async function askOne(it: Item, key: string, f: typeof fetch, sleep: (ms: number) => Promise<void>) {
  const { turn_id, ...state } = it
  const body = JSON.stringify({ model: qs.model, state, questions: questionsFor(state.attendees) })
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await f(URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20000) })
    } catch {
      return { turn_id, status: 'unavailable', reason: 'error 0' }
    }
    if ((res.status === 429 || res.status === 529) && attempt < TRIES - 1) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    if (res.status === 401) return { turn_id, status: 'unavailable', reason: 'key-refused' }
    if (!res.ok) return { turn_id, status: 'unavailable', reason: `error ${res.status}` }
    const r = await res.json().catch(() => null)
    const noul = r?.answers?.commitment?.noul
    if (typeof noul !== 'number') return { turn_id, status: 'unavailable', reason: 'error 502' }
    return {
      turn_id, status: 'ok', model: String(r.model ?? qs.model), sent_hash: await stateHash(state), commitment: noul,
      owner_a: owner(r.answers.owner_a), owner_b: owner(r.answers.owner_b),
    }
  }
}

export async function handleConfirm(
  body: unknown, env: Env, f: typeof fetch, log: (line: string) => void = console.log,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Reply> {
  const why = invalid(body)
  if (why) {
    log(`jev confirm: rejected (${why})`)
    return { status: 400, body: { error: why } }
  }
  const items = (body as { items: Item[] }).items
  // Patterns only (SSN format, card numbers): the values found in this transcript stay in the browser,
  // which scans for them before sending (contracts/jev-proxy.md).
  const hits = finalScan(items.map(itemText), [])
  if (hits.length) {
    const turn_ids = [...new Set(hits.map((h) => items[h.index].turn_id))]
    log(`jev confirm: blocked, ${turn_ids.length} of ${items.length} items still held sensitive text; nothing sent`)
    return { status: 422, body: { status: 'redaction-blocked', turn_ids } }
  }
  const status = handleStatus(env).body as { available: boolean; reason?: string }
  if (!status.available) {
    log(`jev confirm: unavailable (${status.reason}), ${items.length} items`)
    return { status: 200, body: { question_set: qs.question_set, answers: items.map((i) => ({ turn_id: i.turn_id, status: 'unavailable', reason: status.reason === 'disabled' ? 'off' : status.reason })) } }
  }
  const t0 = Date.now()
  const answers: Record<string, unknown>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      answers[i] = await askOne(items[i], env.TYPESAFE_API_KEY!, f, sleep)
    }
  }
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, items.length) }, worker))
  log(`jev confirm: ${items.length} items, ${answers.filter((a) => a.status === 'ok').length} ok, ${Date.now() - t0} ms`)
  return { status: 200, body: { question_set: qs.question_set, answers } }
}
