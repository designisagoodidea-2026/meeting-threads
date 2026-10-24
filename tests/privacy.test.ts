import { describe, expect, it } from 'vitest'
import { applyPrivacy } from '../src/data/privacy'
import { computeLayout } from '../src/layout/layouts'
import { itemLines } from '../src/threads/threads'
import { deriveSuggestions } from '../src/threads/suggestions'
import { model } from './fixtures'

const NONE = { hiddenMeetingIds: [], excludedPersonIds: [] }
const CRIT = 'evt_20261102_1100' // Mon crit: onboarding v3, the story meeting with the most beads

describe('applyPrivacy', () => {
  const base = model()

  it('changes nothing when nothing is hidden or excluded', () => {
    const p = applyPrivacy(base, NONE)
    expect(deriveSuggestions(p, {})).toEqual(deriveSuggestions(base, {}))
    expect(p.actionItems).toEqual(base.actionItems)
  })

  it("hiding a meeting removes all its turns, beads and suggestions but keeps the meeting (SC-006)", () => {
    const p = applyPrivacy(base, { ...NONE, hiddenMeetingIds: [CRIT] })
    const m = p.meetingById.get(CRIT)!
    expect(m).toBeTruthy()
    expect(m.transcript).toBeNull()
    expect(m.transcriptHidden).toBe(true)
    expect(p.themes.flatMap((t) => t.turnIds).some((id) => id.startsWith(`${CRIT}#`))).toBe(false)
    const beads = itemLines(p, computeLayout(p, 'type', { dayWidth: 600, height: 700 }).items, deriveSuggestions(p, {}))
    expect(beads.some((b) => b.meetingId === CRIT)).toBe(false)
    expect(deriveSuggestions(p, {}).some((s) => s.sources.some((x) => x.meetingId === CRIT))).toBe(false)
    expect(deriveSuggestions(base, {}).some((s) => s.sources.some((x) => x.meetingId === CRIT))).toBe(true)
    expect(base.meetingById.get(CRIT)!.transcript).not.toBeNull() // the source model is untouched
  })

  it('excluding a person drops suggestions drawn from what they said', () => {
    const lena = 'lena@northwind.example'
    const said = (s: ReturnType<typeof deriveSuggestions>[number], m = base) =>
      s.sources.some((x) => m.meetingById.get(x.meetingId)!.transcript!.find((t) => t.id === x.turnId)!.speakerId === lena)
    expect(deriveSuggestions(base, {}).some((s) => said(s))).toBe(true)
    const p = applyPrivacy(base, { ...NONE, excludedPersonIds: [lena] })
    expect(deriveSuggestions(p, {}).some((s) => said(s, p))).toBe(false)
  })

  it('reversing a setting brings the same suggestions back with their stored decisions', () => {
    const before = deriveSuggestions(base, {})
    const decisions = { [before[0].id]: { status: 'accepted' as const, at: 'x' } }
    applyPrivacy(base, { hiddenMeetingIds: [CRIT], excludedPersonIds: ['lena@northwind.example'] })
    expect(deriveSuggestions(applyPrivacy(base, NONE), decisions)).toEqual(deriveSuggestions(base, decisions))
  })
})
