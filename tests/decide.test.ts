import { describe, expect, it } from 'vitest'
import { decide, ownerFor, reusable } from '../src/jev/decide'
import type { Candidate, JevAnswer } from '../src/jev/types'

// Spec 007 FR-002 to FR-005, FR-012 to FR-014; research R5, R6, R8.
const people = [{ id: 'sam@x', name: 'Sam Rivera' }, { id: 'dev@x', name: 'Dev Patel' }]
const cand: Candidate = { turnId: 'm#4', speakerId: 'sam@x', cue: "I'll" }
const ans = (commitment: number, a = 'Sam Rivera', b = 'Sam Rivera', ca = 0.9, cb = 0.9): JevAnswer => ({
  turnId: 'm#4', questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: 'h1', commitment,
  ownerA: { choice: a, confidence: ca }, ownerB: { choice: b, confidence: cb }, status: 'ok', reason: null,
})
const off: JevAnswer = { ...ans(0), commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason: 'no-key' }

describe('decide', () => {
  it('uses the 0.7 and 0.3 thresholds, both inclusive', () => {
    const at = (x: number) => decide({ candidate: cand, answer: ans(x), rulesSay: false, attendees: people })!.outcome
    expect([at(0.7), at(0.69), at(0.31), at(0.3), at(0.95), at(0.05)]).toEqual(['commitment', 'needs-a-look', 'needs-a-look', 'set-aside', 'commitment', 'set-aside'])
  })

  it('shows Jev’s rating and who decided, and starts unselected', () => {
    expect(decide({ candidate: cand, answer: ans(0.82), rulesSay: true, attendees: people })).toEqual({
      turnId: 'm#4', outcome: 'commitment', decidedBy: 'jev', rating: 0.82, ownerId: 'sam@x', ownerUnsure: false, selected: false,
    })
    expect(decide({ candidate: cand, answer: ans(0.82), fromBundle: true, rulesSay: true, attendees: people })!.decidedBy).toBe('bundle')
  })

  it('falls back to rules with no rating when Jev didn’t answer, and has no set-aside', () => {
    expect(decide({ candidate: cand, answer: off, rulesSay: true, attendees: people })).toMatchObject({ outcome: 'commitment', decidedBy: 'rules', rating: null })
    expect(decide({ candidate: cand, answer: off, rulesSay: false, attendees: people })).toBeNull()
    expect(decide({ candidate: cand, answer: null, rulesSay: true, attendees: people })).toMatchObject({ decidedBy: 'rules', rating: null })
  })
})

describe('ownerFor', () => {
  it('takes Jev’s owner only when both orders agree with confidence ≥ 0.5', () => {
    expect(ownerFor(ans(0.9, 'Dev Patel', 'Dev Patel'), people, 'sam@x')).toEqual({ ownerId: 'dev@x', ownerUnsure: false })
    expect(ownerFor(ans(0.9, 'Dev Patel', 'Sam Rivera'), people, 'sam@x')).toEqual({ ownerId: 'sam@x', ownerUnsure: true })
    expect(ownerFor(ans(0.9, 'Dev Patel', 'Dev Patel', 0.9, 0.49), people, 'sam@x')).toEqual({ ownerId: 'sam@x', ownerUnsure: true })
  })
  it('matches an owner by first name too, and leaves an unknown speaker unowned when unsure', () => {
    expect(ownerFor(ans(0.9, 'Dev', 'Dev'), people, 'sam@x').ownerId).toBe('dev@x')
    expect(ownerFor(ans(0.9, 'Dev', 'Sam'), people, null)).toEqual({ ownerId: null, ownerUnsure: true })
  })
})

describe('reusable', () => {
  it('reuses only when question set, model and the sent text all match', () => {
    const sent = { questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: 'h1' }
    expect(reusable(ans(0.8), sent)).toBe('reuse')
    expect(reusable(ans(0.8), { ...sent, model: 'jev-1.14.0' })).toBe('version-mismatch')
    expect(reusable(ans(0.8), { ...sent, questionSet: 'mt-turn-2' })).toBe('version-mismatch')
    expect(reusable(ans(0.8), { ...sent, sentHash: 'h2' })).toBe('stale')
    expect(reusable(off, sent)).toBe('stale')
  })
})
