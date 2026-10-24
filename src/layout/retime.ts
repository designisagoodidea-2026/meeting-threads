import { localDate, localMinutes, zoned, type TimeOverride } from '../data/load'
import type { Model } from '../data/types'
import { DAY_SPAN_MIN, DAY_START_MIN } from './layouts'

export type RetimeMode = 'move' | 'start' | 'end'
const STEP = 15
const DAY_END_MIN = DAY_START_MIN + DAY_SPAN_MIN

// Where a dragged upcoming meeting lands (spec 006 FR-038), from how far it was dragged in minutes of
// canvas time: moves snap to 15 minutes and carry across days; edges resize, never under 15 minutes.
// Stays inside 8:00–18:00 and after now. Null when the meeting can't move there or nothing changes.
export function retime(model: Model, meetingId: string, mode: RetimeMode, minutes: number): TimeOverride | null {
  const m = model.meetingById.get(meetingId)
  if (!m?.upcoming) return null
  const tz = model.timeZone
  const day = model.days.indexOf(localDate(m.start, tz))
  const s = localMinutes(m.start, tz)
  const e = s + (+m.end - +m.start) / 60e3
  const step = Math.round(minutes / STEP) * STEP
  if (!step || day < 0) return null

  let r: TimeOverride
  if (mode === 'move') {
    const dur = e - s
    const at = day * DAY_SPAN_MIN + (s - DAY_START_MIN) + step
    const d = Math.floor(at / DAY_SPAN_MIN)
    if (d < 0 || d >= model.days.length) return null
    const off = Math.min(at - d * DAY_SPAN_MIN, DAY_SPAN_MIN - dur)
    r = { day: d, start: DAY_START_MIN + off, end: DAY_START_MIN + off + dur }
  } else if (mode === 'end') {
    r = { day, start: s, end: Math.min(DAY_END_MIN, Math.max(s + STEP, e + step)) }
  } else {
    r = { day, start: Math.max(DAY_START_MIN, Math.min(e - STEP, s + step)), end: e }
  }
  if (r.day === day && r.start === s && r.end === e) return null
  if (model.now && +zoned(model.days[r.day], r.start, tz) <= +model.now) return null
  return r
}
