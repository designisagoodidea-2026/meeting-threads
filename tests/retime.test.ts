import { describe, expect, it } from 'vitest'
import { buildModel, localDate, localMinutes, rebaseFiles } from '../src/data/load'
import { retime } from '../src/layout/retime'
import { rawData } from './fixtures'

const NOW = new Date('2026-10-24T19:00:00Z') // Saturday noon in Los Angeles
const f = rebaseFiles(rawData(), NOW)
const m = buildModel(f.calendar, f.transcripts, f.annotations, NOW)
const tz = m.timeZone
const up = m.meetings.find((x) => x.upcoming && localMinutes(x.start, tz) >= 600 && localMinutes(x.end, tz) <= 960)!
const day = m.days.indexOf(localDate(up.start, tz))
const s0 = localMinutes(up.start, tz)
const e0 = localMinutes(up.end, tz)

describe('retime: dragging an upcoming meeting (FR-038)', () => {
  it('moves by whole 15-minute steps, keeping its length', () => {
    expect(retime(m, up.id, 'move', 37)).toEqual({ day, start: s0 + 30, end: e0 + 30 })
    expect(retime(m, up.id, 'move', -16)).toEqual({ day, start: s0 - 15, end: e0 - 15 })
  })
  it('carries across days: a full day of canvas lands on the same time the next working day', () => {
    expect(retime(m, up.id, 'move', 600)).toEqual(day < m.days.length - 1 ? { day: day + 1, start: s0, end: e0 } : null)
  })
  it('keeps the meeting inside the 8:00 to 18:00 day', () => {
    const late = retime(m, up.id, 'move', 1080 - e0 + 120)! // past 18:00 on its day stays at the end of it, or the next day
    expect(late.end - late.start).toBe(e0 - s0)
    expect(late.end).toBeLessThanOrEqual(1080)
    expect(late.start).toBeGreaterThanOrEqual(480)
  })
  it('resizes from either edge, never shorter than 15 minutes or outside the day', () => {
    expect(retime(m, up.id, 'end', 30)).toEqual({ day, start: s0, end: e0 + 30 })
    expect(retime(m, up.id, 'end', -999)).toEqual({ day, start: s0, end: s0 + 15 })
    expect(retime(m, up.id, 'start', -999)).toEqual({ day, start: 480, end: e0 })
    expect(retime(m, up.id, 'end', 999)).toEqual({ day, start: s0, end: 1080 })
  })
  it('refuses meetings that already happened, moves into the past, and no-ops', () => {
    const past = m.meetings.find((x) => !x.upcoming)!
    expect(retime(m, past.id, 'move', 30)).toBeNull()
    expect(retime(m, up.id, 'move', -600 * 10)).toBeNull()
    expect(retime(m, up.id, 'move', 5)).toBeNull()
  })
})
