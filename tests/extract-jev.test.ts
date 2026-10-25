import { describe, expect, it } from 'vitest'
import { extractAnnotations, extractWithJev, jevGaps, jevReason, keptItems, parseTranscript, type Confirm } from '../src/data/extract'
import { leakedTurns, type JevItem } from '../src/jev/client'
import type { JevAnswer } from '../src/jev/types'
import { model } from './fixtures'

// Spec 007 T015: rules propose, a stand-in for Jev rates, decide() sorts, only kept lines become items.
const M = 'evt_20261112_1100'
const text = [
  "Sam Rivera: I'll be honest, this is fine.",
  'Dev Patel: My card is 4111 1111 1111 1111, I can read it again.',
  "Sam Rivera: I'm drafting the brief tonight.",
  "Dev Patel: I'll take that: price out a standing participant panel.",
  "Sam Rivera: I'll probably look at the panel numbers sometime.",
].join('\n')
const ratings: Record<string, number> = { [`${M}#0`]: 0.1, [`${M}#1`]: 0.2, [`${M}#2`]: 0.85, [`${M}#3`]: 0.9, [`${M}#4`]: 0.5 }

function fakeJev(seen: JevItem[][] = []): Confirm {
  return async (items) => {
    seen.push(items)
    return items.map((it): JevAnswer => ({
      turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: 'set-below', commitment: ratings[it.turn_id],
      ownerA: { choice: it.speaker, confidence: 0.9 }, ownerB: { choice: it.speaker, confidence: 0.9 }, status: 'ok', reason: null,
    }))
  }
}

describe('extractWithJev', () => {
  const m = model()
  const tr = parseTranscript(text, M)

  it('sorts candidates into commitments, needs a look and set aside, catching one the rules miss', async () => {
    const out = await extractWithJev(m, M, tr, fakeJev())
    const by = Object.fromEntries(out.jev.decisions.map((d) => [d.turnId, d.outcome]))
    expect(by).toEqual({ [`${M}#0`]: 'set-aside', [`${M}#1`]: 'set-aside', [`${M}#2`]: 'commitment', [`${M}#3`]: 'commitment', [`${M}#4`]: 'needs-a-look' })
    expect(out.jev.used).toBe(true)
    expect(out.actionItems.find((a) => a.sourceTurnId === `${M}#2`)).toMatchObject({ ownerId: 'sam@northwind.example', text: "I'm drafting the brief tonight" })
    expect(out.actionItems.find((a) => a.sourceTurnId === `${M}#3`)?.text).toBe('Price out a standing participant panel')
  })

  it('keeps commitments and only the ticked "needs a look" lines', async () => {
    const out = await extractWithJev(m, M, tr, fakeJev())
    const imp = { ...out, transcript: tr }
    expect(keptItems(imp).map((a) => a.sourceTurnId)).toEqual([`${M}#2`, `${M}#3`])
    imp.jev.decisions.find((d) => d.outcome === 'needs-a-look')!.selected = true
    expect(keptItems(imp).map((a) => a.sourceTurnId)).toEqual([`${M}#2`, `${M}#3`, `${M}#4`])
  })

  it('sends only redacted text, and never the values it found', async () => {
    const seen: unknown[][] = []
    await extractWithJev(m, M, tr, async (...args) => (seen.push(args), fakeJev()(args[0])))
    const sent = JSON.stringify(seen)
    expect(seen[0]).toHaveLength(1) // items only: no registry argument
    expect(sent).not.toMatch(/4111/)
    expect(sent).toContain('[card number]')
  })

  it('falls back to the plain rules, with no ratings, when Jev is unavailable', async () => {
    const off: Confirm = async (items) => items.map((it) => ({ turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: '', commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason: 'no-key' }))
    const out = await extractWithJev(m, M, tr, off)
    expect(out.jev.used).toBe(false)
    expect(out.jev.decisions.every((d) => d.decidedBy === 'rules' && d.rating === null)).toBe(true)
    expect(out.actionItems).toEqual(extractAnnotations(m, M, tr).actionItems)
  })

  it('reuses saved answers for the same redacted text instead of asking again', async () => {
    const seen: JevItem[][] = []
    const first = await extractWithJev(m, M, tr, async (items) => {
      const { stateHash } = await import('../src/jev/proxy')
      const ans = await fakeJev(seen)(items)
      return Promise.all(ans.map(async (a, i) => ({ ...a, sentHash: await stateHash((({ turn_id, ...s }) => s)(items[i])) })))
    })
    const again: JevItem[][] = []
    await extractWithJev(m, M, tr, fakeJev(again), first.jev.answers)
    expect(seen[0]).toHaveLength(5)
    expect(again).toHaveLength(0)
  })
})

describe('extractWithJev when the proxy blocks the request', () => {
  it('falls back to the rules for the whole transcript and keeps the reason', async () => {
    const m = model()
    const tr = parseTranscript(text, M)
    const blocked: Confirm = async (items) => items.map((it) => ({ turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: '', commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason: 'redaction-blocked' }))
    const out = await extractWithJev(m, M, tr, blocked)
    expect(out.jev.used).toBe(false)
    expect(out.actionItems).toEqual(extractAnnotations(m, M, tr).actionItems)
    expect(jevReason(out.jev)).toBe('redaction-blocked')
  })
})

describe('leakedTurns (the browser scan before anything is sent, FR-008)', () => {
  const it0 = { turn_id: 'm#1', meeting: 'Sync', attendees: ['Sam'], speaker: 'Sam', earlier_turns: ['Dev: born September 3rd'], turn: "I'll send it." }
  it('finds a found value or a sensitive pattern anywhere in an item, including earlier turns', () => {
    expect(leakedTurns([it0], ['September 3rd'])).toEqual(['m#1'])
    expect(leakedTurns([{ ...it0, earlier_turns: [], turn: 'SSN 123-45-6789' }], [])).toEqual(['m#1'])
    expect(leakedTurns([{ ...it0, earlier_turns: [] }], ['September 3rd'])).toEqual([])
  })
})

describe('jevGaps (FR-014)', () => {
  const ans = (turnId: string, ok: boolean, reason: JevAnswer['reason'] = null): JevAnswer => ({ turnId, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: '', commitment: ok ? 0.9 : null, ownerA: null, ownerB: null, status: ok ? 'ok' : 'unavailable', reason })
  it('counts the lines Jev left to the rules, with the most common reason, only when Jev answered some', () => {
    expect(jevGaps({ used: true, decisions: [], answers: [ans('a', true), ans('b', false, 'error 529'), ans('c', false, 'error 529'), ans('d', false, 'error 0')] })).toEqual({ count: 3, reason: 'error 529' })
    expect(jevGaps({ used: true, decisions: [], answers: [ans('a', true)] })).toBeNull()
    expect(jevGaps({ used: false, decisions: [], answers: [ans('b', false, 'no-key')] })).toBeNull() // the whole-import reason covers it
  })
})

describe('a speaker who is not on the invite (found end to end with Atlas)', () => {
  const m = model()
  const tr = parseTranscript("Sam Rivera: Great work.\nJordan Vale: Thanks Sam. Let me write up the decision note tonight.", M)
  it('is offered to Jev as a possible owner, so the task is not pinned on someone who is', async () => {
    const seen: JevItem[] = []
    const out = await extractWithJev(m, M, tr, async (items) => (seen.push(...items), items.map((it) => ({
      turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: '', commitment: 0.95,
      ownerA: { choice: 'Jordan Vale', confidence: 0.98 }, ownerB: { choice: 'Jordan Vale', confidence: 0.97 }, status: 'ok' as const, reason: null,
    }))))
    expect(seen[0].attendees).toContain('Jordan Vale')
    const d = out.jev.decisions.find((x) => x.turnId === `${M}#1`)!
    expect(d).toMatchObject({ outcome: 'commitment', ownerId: null, ownerUnsure: true })
    expect(out.actionItems.find((a) => a.sourceTurnId === `${M}#1`)).toBeUndefined()
  })
})
