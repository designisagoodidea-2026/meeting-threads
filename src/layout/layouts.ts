import { localDate, localMinutes } from '../data/load'
import { MEETING_TYPES, type MeetingType, type Model } from '../data/types'
import { orderLanes } from './lanes'

export type Pivot = 'project' | 'people' | 'type' | 'theme'

export type Box = { x: number; y: number; w: number; h: number; z?: number }
// `segments` (people pivot only): the lanes inside a block's span, relative to its top; `on` = attendee.
// `label`: the row the title label belongs to and the vertical area it may use, relative to the block's top.
export type Item = Box & {
  meetingId: string
  segments?: { y: number; h: number; on: boolean }[]
  label?: { row: string; y: number; h: number }
  themes?: string[] // project and theme pivots: the themes this copy carries, so threads run along its row
  t?: number
}
// Keys are meeting ids, or `${meetingId}#${themeId}` for the copies in the theme pivot.
export type Layout = Map<string, Item>
export type Row = { key: string; label: string; sublabel?: string; color?: string; y: number; h: number }
export type Frame = { items: Layout; rows: Row[]; width: number }

export const DAY_START_MIN = 8 * 60 // the canvas shows 8:00 to 18:00 each day
export const DAY_SPAN_MIN = 10 * 60

export const TYPE_LABELS: Record<MeetingType, string> = {
  'one-on-one': '1:1',
  'team-sync': 'Team sync',
  'design-crit': 'Design crit',
  'stakeholder-review': 'Stakeholder review',
  interview: 'Interview',
  external: 'External',
}

export function computeLayout(model: Model, pivot: Pivot, vp: { dayWidth: number; height: number }): Frame {
  const { dayWidth, height } = vp
  const px = dayWidth / DAY_SPAN_MIN
  const xw = (id: string) => {
    const m = model.meetingById.get(id)!
    const day = model.days.indexOf(localDate(m.start, model.timeZone))
    const x = day * dayWidth + (localMinutes(m.start, model.timeZone) - DAY_START_MIN) * px + 1
    return { x, w: Math.max(4, ((+m.end - +m.start) / 60e3) * px - 2) }
  }
  const items: Layout = new Map()
  let rows: Row[]

  const banded = (keys: { key: string; label: string; sublabel?: string; color?: string }[]) => {
    const h = height / keys.length
    return keys.map((k, i) => ({ ...k, y: i * h, h }))
  }
  const inRow = (r: Row) => {
    const pad = Math.min(8, r.h * 0.12)
    return { y: r.y + pad, h: r.h - 2 * pad }
  }

  if (pivot === 'project') {
    // One row per project; a meeting appears in every project whose themes it touches.
    const unassigned = model.meetings.some((m) => !model.projects.some((p) => p.themeIds.some((t) => m.themeIds.includes(t))))
    rows = banded([
      ...model.projects.map((p) => ({ key: p.id, label: p.name, sublabel: p.themeIds.map((t) => model.themes.find((x) => x.id === t)!.name).join(' · ') })),
      ...(unassigned ? [{ key: 'none', label: 'No project' }] : []), // only when some meeting has no project
    ])
    for (const m of model.meetings) {
      const projects = model.projects.filter((p) => p.themeIds.some((t) => m.themeIds.includes(t)))
      for (const p of projects.length ? projects : [null]) {
        const key = p?.id ?? 'none'
        const box = inRow(rows.find((r) => r.key === key)!)
        items.set(`${m.id}#${key}`, {
          meetingId: m.id, ...xw(m.id), ...box, label: { row: key, y: 0, h: box.h },
          themes: p ? m.themeIds.filter((t) => p.themeIds.includes(t)) : [],
        })
      }
    }
  } else if (pivot === 'type') {
    rows = banded(MEETING_TYPES.map((t) => ({ key: t, label: TYPE_LABELS[t] })))
    for (const m of model.meetings) {
      const box = inRow(rows.find((r) => r.key === m.type)!)
      items.set(m.id, { meetingId: m.id, ...xw(m.id), ...box, label: { row: m.type, y: 0, h: box.h } })
    }
  } else if (pivot === 'people') {
    const lanes = orderLanes(model.meetings, [...model.people.values()])
    rows = banded(lanes.map((id) => ({ key: id, label: model.people.get(id)!.name, sublabel: model.people.get(id)!.role })))
    const laneH = rows[0]?.h ?? height
    const pad = Math.min(3, laneH * 0.1)
    for (const m of model.meetings) {
      const idx = m.attendeeIds.map((id) => lanes.indexOf(id)).filter((i) => i >= 0)
      const lo = Math.min(...idx)
      const hi = Math.max(...idx)
      const y = lo * laneH + pad
      const segments = []
      for (let i = lo; i <= hi; i++) segments.push({ y: i * laneH - y + pad, h: laneH - 2 * pad, on: idx.includes(i) })
      const first = segments.find((sg) => sg.on)!
      items.set(m.id, {
        meetingId: m.id, ...xw(m.id), y, h: (hi + 1) * laneH - pad - y, segments,
        label: { row: lanes[lo], y: first.y, h: first.h },
      })
    }
  } else {
    rows = banded([
      ...model.themes.map((t) => ({ key: t.id, label: t.name, color: t.color })),
      { key: 'none', label: 'No theme' },
    ])
    for (const m of model.meetings)
      for (const th of m.themeIds.length ? m.themeIds : ['none'])
      {
        const box = inRow(rows.find((r) => r.key === th)!)
        items.set(`${m.id}#${th}`, { meetingId: m.id, ...xw(m.id), ...box, label: { row: th, y: 0, h: box.h }, themes: th === 'none' ? [] : [th] })
      }
  }
  return { items, rows, width: model.days.length * dayWidth }
}
