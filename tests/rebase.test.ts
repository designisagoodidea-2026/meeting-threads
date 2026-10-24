import { describe, expect, it } from 'vitest'
import { buildModel, localDate, localMinutes, rebaseFiles } from '../src/data/load'
import { deriveSuggestions } from '../src/threads/suggestions'
import { rawData } from './fixtures'

const TZ = 'America/Los_Angeles'
const SAT_NOON = new Date('2026-10-24T19:00:00Z') // Saturday Oct 24, 12:00 in Los Angeles
const WED_1PM = new Date('2026-10-28T20:00:00Z') // Wednesday Oct 28, 13:00

describe('rebaseFiles: the two weeks follow the real date (FR-036)', () => {
  const raw = rawData()
  it('on a weekend, starts two working days back and runs ten working days', () => {
    const f = rebaseFiles(rawData(), SAT_NOON)
    const m = buildModel(f.calendar, f.transcripts, f.annotations, SAT_NOON)
    expect(m.days).toEqual(['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04'])
  })
  it('keeps each meeting on its working day and local time, across the daylight-saving change', () => {
    const f = rebaseFiles(rawData(), SAT_NOON)
    const orig = buildModel(raw.calendar, raw.transcripts, raw.annotations)
    const m = buildModel(f.calendar, f.transcripts, f.annotations, SAT_NOON)
    for (const o of orig.meetings) {
      const n = m.meetingById.get(o.id)!
      expect(m.days.indexOf(localDate(n.start, TZ))).toBe(orig.days.indexOf(localDate(o.start, TZ)))
      expect(localMinutes(n.start, TZ)).toBe(localMinutes(o.start, TZ))
      expect(+n.end - +n.start).toBe(+o.end - +o.start)
    }
  })
  it('keeps transcripts and action items only for meetings that have ended', () => {
    const f = rebaseFiles(rawData(), WED_1PM)
    const m = buildModel(f.calendar, f.transcripts, f.annotations, WED_1PM)
    expect(m.days[2]).toBe('2026-10-28')
    for (const x of m.meetings) {
      if (+x.end <= +WED_1PM) expect(x.upcoming).toBe(false)
      else expect([x.upcoming, x.transcript]).toEqual([+x.start > +WED_1PM, null]) // in progress: not upcoming, not yet recorded
    }
    expect(m.meetings.some((x) => x.transcript && localDate(x.start, TZ) === '2026-10-28')).toBe(true) // this morning's
    for (const a of m.actionItems) expect(+m.meetingById.get(a.meetingId)!.end).toBeLessThanOrEqual(+WED_1PM)
    expect(m.actionItems.length).toBeGreaterThan(0)
  })
  it('suggests only upcoming meetings as targets', () => {
    const f = rebaseFiles(rawData(), SAT_NOON)
    const m = buildModel(f.calendar, f.transcripts, f.annotations, SAT_NOON)
    const s = deriveSuggestions(m, {})
    expect(s.length).toBeGreaterThan(0)
    for (const x of s) if (x.targetMeetingId) expect(+m.meetingById.get(x.targetMeetingId)!.start).toBeGreaterThan(+SAT_NOON)
  })
  it('applies a dragged time as a window day plus minutes', () => {
    const id = raw.calendar.items.at(-1)!.id
    const f = rebaseFiles(rawData(), SAT_NOON, { [id]: { day: 4, start: 10 * 60 + 15, end: 11 * 60 } })
    const m = buildModel(f.calendar, f.transcripts, f.annotations, SAT_NOON)
    const x = m.meetingById.get(id)!
    expect([localDate(x.start, TZ), localMinutes(x.start, TZ), localMinutes(x.end, TZ)]).toEqual(['2026-10-28', 615, 660])
  })
})
