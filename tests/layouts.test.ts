import { describe, expect, it } from 'vitest'
import { computeLayout, type Pivot } from '../src/layout/layouts'
import { orderLanes } from '../src/layout/lanes'
import { MEETING_TYPES } from '../src/data/types'
import { model } from './fixtures'

const VP = { dayWidth: 480, height: 600 }
const PIVOTS: Pivot[] = ['project', 'people', 'type', 'theme']

describe('computeLayout', () => {
  const m = model()

  it('places every meeting in every pivot', () => {
    for (const p of PIVOTS) {
      const { items } = computeLayout(m, p, VP)
      const placed = new Set([...items.values()].map((i) => i.meetingId))
      expect(placed.size, p).toBe(m.meetings.length)
    }
  })

  it('keeps x and width tied to time in every pivot (FR-008)', () => {
    const row = computeLayout(m, 'type', VP).items
    for (const p of PIVOTS) {
      for (const it of computeLayout(m, p, VP).items.values()) {
        const base = row.get(it.meetingId)!
        expect(it.x).toBe(base.x)
        expect(it.w).toBe(base.w)
      }
    }
    // later meetings sit further right
    const xs = m.meetings.map((x) => row.get(x.id)!.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('uses exactly the six meeting-type rows, in order', () => {
    const { rows, items } = computeLayout(m, 'type', VP)
    expect(rows.map((r) => r.key)).toEqual([...MEETING_TYPES])
    for (const mt of m.meetings) {
      const it = items.get(mt.id)!
      const row = rows.find((r) => r.key === mt.type)!
      expect(it.y).toBeGreaterThanOrEqual(row.y)
      expect(it.y + it.h).toBeLessThanOrEqual(row.y + row.h)
    }
  })

  it('in the people pivot, spans a block from its topmost to its bottommost attendee lane', () => {
    const { rows, items } = computeLayout(m, 'people', VP)
    expect(rows.map((r) => r.key)).toEqual(orderLanes(m.meetings, [...m.people.values()]))
    for (const mt of m.meetings) {
      const lanes = rows.filter((r) => mt.attendeeIds.includes(r.key))
      const it = items.get(mt.id)!
      const top = Math.min(...lanes.map((r) => r.y))
      const bottom = Math.max(...lanes.map((r) => r.y + r.h))
      expect(it.y).toBeGreaterThanOrEqual(top)
      expect(it.y).toBeLessThan(top + lanes[0].h)
      expect(it.y + it.h).toBeLessThanOrEqual(bottom)
      expect(it.y + it.h).toBeGreaterThan(bottom - lanes[0].h)
      // marks which lanes inside the span are attendees
      expect(it.segments!.filter((s) => s.on)).toHaveLength(lanes.length)
    }
  })

  it('in the project pivot, has one copy per project the meeting touches, carrying that project\'s themes, and a "No project" row only when needed', () => {
    const { rows, items } = computeLayout(m, 'project', VP)
    const unassigned = m.meetings.some((x) => !m.projects.some((p) => p.themeIds.some((t) => x.themeIds.includes(t))))
    expect(rows.map((r) => r.key)).toEqual([...m.projects.map((p) => p.id), ...(unassigned ? ['none'] : [])])
    for (const mt of m.meetings) {
      const projects = m.projects.filter((p) => p.themeIds.some((t) => mt.themeIds.includes(t)))
      const keys = [...items.keys()].filter((k) => items.get(k)!.meetingId === mt.id)
      expect(keys.sort()).toEqual((projects.length ? projects.map((p) => `${mt.id}#${p.id}`) : [`${mt.id}#none`]).sort())
      for (const p of projects) expect(items.get(`${mt.id}#${p.id}`)!.themes).toEqual(mt.themeIds.filter((t) => p.themeIds.includes(t)))
    }
  })

  it('in the theme pivot, has one copy per theme touched, and a "No theme" row', () => {
    const { rows, items } = computeLayout(m, 'theme', VP)
    expect(rows.map((r) => r.key)).toEqual([...m.themes.map((t) => t.id), 'none'])
    for (const mt of m.meetings) {
      const keys = [...items.keys()].filter((k) => items.get(k)!.meetingId === mt.id)
      const want = mt.themeIds.length ? mt.themeIds.map((t) => `${mt.id}#${t}`) : [`${mt.id}#none`]
      expect(keys.sort()).toEqual(want.sort())
    }
  })
})

describe('calendar view: every meeting on one band (FR-045)', () => {
  const m = model()
  const f = computeLayout(m, 'calendar', { dayWidth: 600, height: 600 })
  const items = [...f.items.values()]
  it('has a single row and places each meeting exactly once', () => {
    expect(f.rows).toHaveLength(1)
    expect(items.map((i) => i.meetingId).sort()).toEqual(m.meetings.map((x) => x.id).sort())
  })
  it('stacks meetings that overlap in time so their boxes never overlap', () => {
    for (const a of items)
      for (const b of items) {
        if (a === b) continue
        const ma = m.meetingById.get(a.meetingId)!
        const mb = m.meetingById.get(b.meetingId)!
        if (+ma.start < +mb.end && +mb.start < +ma.end) expect(a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5).toBe(true)
      }
  })
  it('lets a meeting with nothing beside it fill the band', () => {
    const row = f.rows[0]
    const alone = items.find((a) => {
      const ma = m.meetingById.get(a.meetingId)!
      return !m.meetings.some((x) => x.id !== ma.id && +x.start < +ma.end && +ma.start < +x.end)
    })!
    expect(alone.h).toBeGreaterThan(row.h * 0.7)
  })
})
