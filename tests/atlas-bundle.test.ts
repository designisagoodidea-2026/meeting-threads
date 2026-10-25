import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bundleAnswers, extractWithJev, parseTranscript, type Confirm } from '../src/data/extract'
import { proposeCandidates } from '../src/jev/candidates'
import type { JevItem } from '../src/jev/client'
import { model } from './fixtures'

// Spec 007 US3 (FR-012, FR-013, contracts/atlas-bundle.md): answers Atlas already has are used as they are.
const M = 'evt_20261112_1100' // a past meeting with Sam and Dev on the invite
const read = (f: string) => readFileSync(new URL(`../eval/jev/sets/${f}`, import.meta.url), 'utf8').replaceAll('Riley', 'Sam Rivera').replaceAll('Diego', 'Dev Patel')
const full = read('atlas-bundle-mtg-01.json')
const half = read('atlas-bundle-mtg-01-half.json')
const spy = () => {
  const asked: JevItem[][] = []
  const confirm: Confirm = async (items) => (asked.push(items), items.map((it) => ({ turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: 'x', commitment: 0.9, ownerA: { choice: it.speaker, confidence: 0.9 }, ownerB: { choice: it.speaker, confidence: 0.9 }, status: 'ok', reason: null })))
  return { asked, confirm }
}

describe('Atlas bundles', () => {
  const m = model()

  it('reads the bundle shape as a transcript, with its people as speakers', () => {
    const tr = parseTranscript(full, M)
    expect(tr.segments).toHaveLength(7)
    expect(tr.speakers.map((s) => s.name)).toEqual(['Sam Rivera', 'Dev Patel'])
    expect(tr.segments[3].text).toMatch(/I'll update/)
  })

  it('takes every mt-turn-1 answer, mapped to this meeting’s turn ids', () => {
    const b = bundleAnswers(full, M)!
    expect(b.answers.map((a) => a.turnId)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `${M}#${i}`))
    expect(b.answers[3]).toMatchObject({ questionSet: 'mt-turn-1', model: 'jev-1.13.0', commitment: 0.96, status: 'ok' })
    expect(b.mismatched).toEqual([])
    expect(bundleAnswers('Sam: hi', M)).toBeNull()
  })

  it('asks Jev nothing when every turn is answered, and says the answers came from the bundle', async () => {
    const { asked, confirm } = spy()
    const tr = parseTranscript(full, M)
    const out = await extractWithJev(m, M, tr, confirm, [], bundleAnswers(full, M)!)
    expect(asked).toHaveLength(0)
    expect(out.jev.decisions.every((d) => d.decidedBy === 'bundle')).toBe(true)
    const yes = out.jev.decisions.filter((d) => d.outcome === 'commitment').map((d) => d.turnId)
    expect(yes).toEqual([`${M}#3`, `${M}#5`, `${M}#6`].filter((id) => out.jev.decisions.some((d) => d.turnId === id)))
    expect(out.actionItems.find((a) => a.sourceTurnId === `${M}#5`)?.ownerId).toBe('dev@northwind.example')
  })

  it('asks only the proposed turns the bundle left unanswered or unavailable', async () => {
    const { asked, confirm } = spy()
    const tr = parseTranscript(half, M)
    const b = bundleAnswers(half, M)!
    await extractWithJev(m, M, tr, confirm, [], b)
    const answered = new Set(b.answers.map((a) => a.turnId))
    const expected = proposeCandidates(tr, {}).map((c) => c.turnId).filter((id) => !answered.has(id))
    expect(expected.length).toBeGreaterThan(0)
    expect(asked.flat().map((i) => i.turn_id)).toEqual(expected)
    expect(answered.has(`${M}#6`)).toBe(false) // the unavailable entry carries no rating
  })

  it('sets aside answers made with a different question set or model, and flags them', async () => {
    const other = full.replace('"model": "jev-1.13.0"', '"model": "jev-1.14.0"').replace('"question_set": "mt-turn-1"', '"question_set": "mt-turn-0"')
    const b = bundleAnswers(other, M)!
    expect(b.mismatched).toEqual([`${M}#0`])
    expect(b.answers.map((a) => a.turnId)).not.toContain(`${M}#0`)
    const { confirm } = spy()
    const out = await extractWithJev(m, M, parseTranscript(other, M), confirm, [], b)
    expect(out.jev.mismatched).toEqual([`${M}#0`])
  })
})
