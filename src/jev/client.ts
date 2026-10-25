import qs from '../../scripts/jev/questions.json'
import { itemText } from './proxy'
import { applyRedactions, buildRegistry, finalScan } from './redact'
import type { JevAnswer, UnavailableReason } from './types'

// The browser side of /api/jev (spec 007 contracts/jev-proxy.md). Never sees the key.

export type JevItem = { turn_id: string; meeting: string; attendees: string[]; speaker: string; earlier_turns: string[]; turn: string }
export type JevStatus = { available: true; model: string } | { available: false; reason: UnavailableReason }

export async function jevStatus(f: typeof fetch = fetch): Promise<JevStatus> {
  try {
    const r = await f('/api/jev/status')
    if (r.status === 404) return { available: false, reason: 'not-on-this-build' }
    if (!r.ok) return { available: false, reason: `error ${r.status}` }
    const b = await r.json()
    if (b.available) return { available: true, model: b.model }
    return { available: false, reason: b.reason === 'disabled' ? 'off' : b.reason }
  } catch {
    // A published page answers /api/jev with its own HTML or nothing at all.
    return { available: false, reason: 'not-on-this-build' }
  }
}

const unavailable = (turnId: string, reason: UnavailableReason): JevAnswer => ({
  turnId, questionSet: qs.question_set, model: qs.model, sentHash: '', commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason,
})

type Wire = { turn_id: string; status: string; reason?: string; model?: string; sent_hash?: string; commitment?: number; owner_a?: JevAnswer['ownerA']; owner_b?: JevAnswer['ownerB'] }

// Batches of up to 200, answers mapped back by turn id. A blocked batch means nothing of it was sent.
// What Jev sees for each candidate (contracts/question-set.md): redacted with a registry built over the
// whole meeting, with two earlier turns. `forms` are the values found, for leakedTurns; they never travel.
export function buildJevItems(meeting: string, attendees: string[], turns: { id: string; speaker: string; text: string }[], candidateIds: string[]) {
  const { turns: red, registry } = applyRedactions(turns, buildRegistry(turns))
  const line = (i: number) => `${turns[i].speaker}: ${red[i].text}`
  const items: JevItem[] = candidateIds.map((id) => {
    const i = turns.findIndex((t) => t.id === id)
    return { turn_id: id, meeting, attendees, speaker: turns[i].speaker, earlier_turns: [i - 2, i - 1].filter((j) => j >= 0).map(line), turn: red[i].text }
  })
  return { items, forms: registry.flatMap((r) => r.forms) }
}

// The full scan before anything is sent (FR-008): the patterns plus every value found in this transcript,
// in every string of every item. Turn ids that still hold one; any at all means nothing is sent.
export function leakedTurns(items: JevItem[], forms: string[]): string[] {
  return [...new Set(finalScan(items.map(itemText), forms).map((h) => items[h.index].turn_id))]
}

export async function confirmCandidates(items: JevItem[], f: typeof fetch = fetch): Promise<JevAnswer[]> {
  const out: JevAnswer[] = []
  for (let i = 0; i < items.length; i += 200) {
    const batch = items.slice(i, i + 200)
    let res: Response
    try {
      res = await f('/api/jev/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_set: qs.question_set, items: batch }) })
    } catch {
      out.push(...batch.map((b) => unavailable(b.turn_id, 'error 0')))
      continue
    }
    if (res.status === 422) {
      out.push(...batch.map((b) => unavailable(b.turn_id, 'redaction-blocked')))
      continue
    }
    if (res.status === 404) {
      out.push(...batch.map((b) => unavailable(b.turn_id, 'not-on-this-build')))
      continue
    }
    if (!res.ok) {
      out.push(...batch.map((b) => unavailable(b.turn_id, `error ${res.status}`)))
      continue
    }
    const byId = new Map(((await res.json()).answers as Wire[]).map((a) => [a.turn_id, a]))
    for (const b of batch) {
      const a = byId.get(b.turn_id)
      if (!a || a.status !== 'ok' || typeof a.commitment !== 'number') out.push(unavailable(b.turn_id, (a?.reason as UnavailableReason) ?? 'error 0'))
      else out.push({ turnId: b.turn_id, questionSet: qs.question_set, model: a.model ?? qs.model, sentHash: a.sent_hash ?? '', commitment: a.commitment, ownerA: a.owner_a ?? null, ownerB: a.owner_b ?? null, status: 'ok', reason: null })
    }
  }
  return out
}
