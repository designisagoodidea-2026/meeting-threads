import { describe, expect, it } from 'vitest'
import { handleConfirm, handleStatus } from '../src/jev/proxy'

// Spec 007 contracts/jev-proxy.md. A fake fetch stands in for TypeSafe; sleep is instant.
const KEY = 'test-key-not-real'
const env = { TYPESAFE_API_KEY: KEY }
const item = (n: number, turn = `I'll send the deck ${n}.`) => ({ turn_id: `m#${n}`, meeting: 'Sync', attendees: ['Sam', 'Dev'], speaker: 'Sam', earlier_turns: ['Dev: ok'], turn })
const req = (items: unknown[], extra = {}) => ({ question_set: 'mt-turn-1', items, ...extra })
const jevOk = () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { commitment: { noul: 0.82 }, owner_a: { choice: 'Sam', confidence: 0.9 }, owner_b: { choice: 'Sam', confidence: 0.8 } } }))
const instant = async () => {}

function fakeFetch(respond: (n: number) => Response | Promise<Response> = jevOk) {
  const calls: { url: string; init: RequestInit }[] = []
  let inFlight = 0
  let peak = 0
  const f = async (url: string, init: RequestInit) => {
    const n = calls.push({ url, init })
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    return respond(n)
  }
  return { f: f as unknown as typeof fetch, calls, peak: () => peak }
}

describe('handleStatus', () => {
  it('says available with the model and set, never the key', () => {
    const r = handleStatus(env)
    expect(r).toEqual({ status: 200, body: { available: true, model: 'jev-1.13.0', question_set: 'mt-turn-1' } })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
  it('reports no key and disabled', () => {
    expect(handleStatus({}).body).toEqual({ available: false, reason: 'no-key' })
    expect(handleStatus({ ...env, JEV_ENABLED: '0' }).body).toEqual({ available: false, reason: 'disabled' })
  })
})

describe('handleConfirm', () => {
  it('rejects bad requests with 400 and sends nothing', async () => {
    const { f, calls } = fakeFetch()
    const bad = [
      req([item(1)], { question_set: 'mt-turn-9' }),
      req([]),
      req(Array.from({ length: 201 }, (_, i) => item(i))),
      req([item(1, 'x'.repeat(4001))]),
      req([{ ...item(1), extra: 1 }]),
      req([item(1)], { surprise: true }),
      req([item(1)], { registry: ['4321'] }), // the browser keeps the found values; they never travel (contract)
      'not an object',
    ]
    for (const b of bad) expect((await handleConfirm(b, env, f, () => {}, instant)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('sends one request per item with the pinned model, the state and both owner orders', async () => {
    const { f, calls } = fakeFetch()
    const r = await handleConfirm(req([item(1)]), env, f, () => {}, instant)
    expect(r.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.state).toEqual({ meeting: 'Sync', attendees: ['Sam', 'Dev'], speaker: 'Sam', earlier_turns: ['Dev: ok'], turn: "I'll send the deck 1." })
    expect(body.questions.commitment.type).toBe('noul')
    expect(Object.keys(body.questions.owner_a.criteria)).toEqual(['Sam', 'Dev'])
    expect(Object.keys(body.questions.owner_b.criteria)).toEqual(['Dev', 'Sam'])
    expect(body.questions.owner_a.criteria.Dev).toBe('Dev does the task')
    const a = (r.body as { answers: Record<string, unknown>[] }).answers[0]
    expect(a).toMatchObject({ turn_id: 'm#1', status: 'ok', model: 'jev-1.13.0', commitment: 0.82, owner_a: { choice: 'Sam', confidence: 0.9 }, owner_b: { choice: 'Sam', confidence: 0.8 } })
    expect(typeof a.sent_hash).toBe('string')
  })

  it('keeps at most 4 requests in flight', async () => {
    const { f, calls, peak } = fakeFetch()
    await handleConfirm(req(Array.from({ length: 12 }, (_, i) => item(i))), env, f, () => {}, instant)
    expect(calls).toHaveLength(12)
    expect(peak()).toBeLessThanOrEqual(4)
  })

  it('retries 429 and 529 with doubling waits, 5 tries, then gives up on that item only', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => void waits.push(ms)
    const busy = fakeFetch((n) => (n <= 2 ? new Response('', { status: 429 }) : n === 3 ? new Response('', { status: 529 }) : jevOk()))
    const r1 = await handleConfirm(req([item(1)]), env, busy.f, () => {}, sleep)
    expect(waits).toEqual([500, 1000, 2000])
    expect((r1.body as { answers: { status: string }[] }).answers[0].status).toBe('ok')

    const down = fakeFetch(() => new Response('', { status: 529 }))
    const r2 = await handleConfirm(req([item(1)]), env, down.f, () => {}, instant)
    expect(down.calls).toHaveLength(5)
    expect((r2.body as { answers: unknown[] }).answers[0]).toEqual({ turn_id: 'm#1', status: 'unavailable', reason: 'error 529' })
  })

  it('reports 401 as key-refused and one failed item never fails the rest', async () => {
    const { f } = fakeFetch((n) => (n === 1 ? new Response('', { status: 401 }) : jevOk()))
    const r = await handleConfirm(req([item(1), item(2)]), env, f, () => {}, instant)
    expect(r.status).toBe(200)
    const answers = (r.body as { answers: { turn_id: string; status: string; reason?: string }[] }).answers
    expect(answers.find((a) => a.status === 'unavailable')?.reason).toBe('key-refused')
    expect(answers.filter((a) => a.status === 'ok')).toHaveLength(1)
  })

  it('blocks the whole request with 422 when a sensitive pattern is left, and sends nothing', async () => {
    const { f, calls } = fakeFetch()
    const r1 = await handleConfirm(req([item(1), item(2, 'My SSN is 123-45-6789.')]), env, f, () => {}, instant)
    expect(r1).toEqual({ status: 422, body: { status: 'redaction-blocked', turn_ids: ['m#2'] } })
    const r2 = await handleConfirm(req([item(3, 'Card 4242 4242 4242 4242.')]), env, f, () => {}, instant)
    expect(r2.status).toBe(422)
    expect(calls).toHaveLength(0)
  })

  it('answers unavailable without a key, sending nothing', async () => {
    const { f, calls } = fakeFetch()
    const r = await handleConfirm(req([item(1)]), {}, f, () => {}, instant)
    expect((r.body as { answers: { reason: string }[] }).answers[0].reason).toBe('no-key')
    expect(calls).toHaveLength(0)
  })

  it('logs counts only: no turn text or key', async () => {
    const lines: string[] = []
    const { f } = fakeFetch()
    await handleConfirm(req([item(1, 'I will email Priya the secret plan.')]), env, f, (l) => lines.push(l), instant)
    await handleConfirm(req([item(2, 'SSN 123-45-6789')]), env, f, (l) => lines.push(l), instant)
    const all = lines.join('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const s of ['secret plan', 'Priya', '6789', KEY]) expect(all).not.toContain(s)
  })
})
