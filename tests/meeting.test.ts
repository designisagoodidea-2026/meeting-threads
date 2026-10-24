import { describe, expect, it } from 'vitest'
import { applyPrivacy } from '../src/data/privacy'
import { meetingSummary } from '../src/threads/meeting'
import { deriveSuggestions } from '../src/threads/suggestions'
import { model } from './fixtures'

const CRIT = 'evt_20261102_1100'
const REVIEW = 'evt_20261104_1000'
const RETEST = `${REVIEW}:retest-progress-meter`

describe('meetingSummary', () => {
  const m = model()
  const sugs = deriveSuggestions(m, { [RETEST]: { status: 'accepted', at: 'x' } })
  const done = new Set(m.actionItems.filter((a) => sugs.find((s) => s.id === RETEST)!.sources.some((x) => x.turnId === a.sourceTurnId)).map((a) => a.id))

  it('lists attendees with the lead first, then others by name', () => {
    const s = meetingSummary(m, REVIEW, sugs, done)
    expect(s.attendees[0]).toBe(m.leadId)
    const rest = s.attendees.slice(1).map((id) => m.people.get(id)!.name)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    expect(new Set(s.attendees)).toEqual(new Set(m.meetingById.get(REVIEW)!.attendeeIds))
  })

  it('splits the agenda into seeded, accepted and pending for this meeting only', () => {
    const s = meetingSummary(m, REVIEW, sugs, done)
    expect(s.agenda.seeded).toEqual(m.meetingById.get(REVIEW)!.agenda)
    expect(s.agenda.accepted.map((x) => x.id)).toEqual([RETEST])
    expect(s.agenda.pending.length).toBeGreaterThan(0)
    for (const x of [...s.agenda.accepted, ...s.agenda.pending]) expect(x.targetMeetingId).toBe(REVIEW)
    expect(s.agenda.pending.every((x) => x.status === 'pending')).toBe(true)
  })

  it('gives the transcript in order with the themes each turn mentions', () => {
    const s = meetingSummary(m, CRIT, sugs, done)
    const turns = m.meetingById.get(CRIT)!.transcript!
    expect(s.transcript!.map((x) => x.turn)).toEqual(turns)
    for (const x of s.transcript!) expect(x.themeIds).toEqual(m.themes.filter((t) => t.turnIds.includes(x.turn.id)).map((t) => t.id))
    expect(s.gap).toBeNull()
  })

  it("gives each theme's previous and next meeting, null at the ends", () => {
    for (const mt of m.meetings) {
      for (const t of meetingSummary(m, mt.id, sugs, done).themes) {
        const ids = m.themes.find((x) => x.id === t.themeId)!.meetingIds
        const i = ids.indexOf(mt.id)
        expect(t.prevMeetingId).toBe(ids[i - 1] ?? null)
        expect(t.nextMeetingId).toBe(ids[i + 1] ?? null)
      }
    }
  })

  it("lists the action items raised here with 'open' or 'on-agenda'", () => {
    const s = meetingSummary(m, CRIT, sugs, done)
    expect(s.actionItems.map((x) => x.item.id).sort()).toEqual(m.actionItems.filter((a) => a.meetingId === CRIT).map((a) => a.id).sort())
    for (const x of s.actionItems) expect(x.status).toBe(done.has(x.item.id) ? 'on-agenda' : 'open')
    expect(s.actionItems.some((x) => x.status === 'on-agenda')).toBe(true)
  })

  it('a hidden meeting has no transcript and no action items; an unrecorded one says so', () => {
    const p = applyPrivacy(m, { hiddenMeetingIds: [CRIT], excludedPersonIds: [] })
    const s = meetingSummary(p, CRIT, deriveSuggestions(p, {}), new Set())
    expect(s).toMatchObject({ transcript: null, gap: 'hidden' })
    expect(s.actionItems).toEqual([])
    const unrecorded = m.meetings.find((x) => !x.transcript)!
    expect(meetingSummary(m, unrecorded.id, sugs, done)).toMatchObject({ transcript: null, gap: 'not-recorded' })
  })

  it('throws on an unknown id', () => {
    expect(() => meetingSummary(m, 'nope', sugs, done)).toThrow()
  })
})
