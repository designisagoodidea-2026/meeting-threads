import type { Model, Suggestion } from '../data/types'
import type { Item, Layout } from '../layout/layouts'

// Theme threads (research R3). Each theme gets its own strand height inside a block, so in the single
// row the threads run as separate parallel strands instead of piling onto one line.

type Pt = { x: number; y: number }
export type Segment = {
  id: string // `${themeId}:${fromMeetingId}:${toMeetingId}`, plus `@${row}` when a theme runs along several rows
  row: string | null // the row this run of the thread belongs to (project and theme pivots), else null
  themeId: string
  fromMeetingId: string
  toMeetingId: string
  fromKey: string
  toKey: string
  path: string
  p0: Pt
  c1: Pt
  c2: Pt
  p1: Pt
}

// The layout key for a meeting's block on a theme's thread: its copy in that theme row when there is one.
export function keyFor(layout: Layout, meetingId: string, themeId: string): string | undefined {
  const copy = `${meetingId}#${themeId}`
  if (layout.has(copy)) return copy
  for (const [k, it] of layout) if (it.meetingId === meetingId && it.themes?.includes(themeId)) return k
  if (layout.has(meetingId)) return meetingId
  for (const [k, it] of layout) if (it.meetingId === meetingId) return k
}

// Strands use the lower part of the block, below where title labels stack.
export function strandY(it: Item, themeIndex: number, themeCount: number): number {
  const top = it.y + (it.label?.y ?? 0)
  const h = it.label?.h ?? it.h
  return top + h * (0.4 + (0.55 * (themeIndex + 1)) / (themeCount + 1))
}

const f = (n: number) => n.toFixed(1)

export function threadSegments(model: Model, layout: Layout): Segment[] {
  const out: Segment[] = []
  model.themes.forEach((theme, ti) => {
    // In the project and theme pivots a theme runs along every row whose copies carry it; elsewhere it
    // runs once across whatever rows its meetings sit in.
    const rows = new Set<string | null>()
    for (const it of layout.values()) if (it.themes?.includes(theme.id)) rows.add(it.label?.row ?? null)
    if (!rows.size) rows.add(null)
    for (const row of rows) {
      const keyIn = (mid: string) => (row === null ? keyFor(layout, mid, theme.id) : layout.has(`${mid}#${row}`) ? `${mid}#${row}` : undefined)
      for (let i = 1; i < theme.meetingIds.length; i++) {
        const fromMeetingId = theme.meetingIds[i - 1]
        const toMeetingId = theme.meetingIds[i]
        const fromKey = keyIn(fromMeetingId)
        const toKey = keyIn(toMeetingId)
        if (!fromKey || !toKey) continue
        const a = layout.get(fromKey)!
        const b = layout.get(toKey)!
        const p0 = { x: a.x + a.w, y: strandY(a, ti, model.themes.length) }
        const p1 = { x: b.x, y: strandY(b, ti, model.themes.length) }
        const dx = Math.max(30, (p1.x - p0.x) / 2)
        const c1 = { x: p0.x + dx, y: p0.y }
        const c2 = { x: p1.x - dx, y: p1.y }
        const base = `${theme.id}:${fromMeetingId}:${toMeetingId}`
        out.push({
          id: row === null || row === theme.id ? base : `${base}@${row}`,
          row, themeId: theme.id, fromMeetingId, toMeetingId, fromKey, toKey, p0, c1, c2, p1,
          path: `M${f(p0.x)} ${f(p0.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p1.x)} ${f(p1.y)}`,
        })
      }
    }
  })
  return out
}

// Where each action item stands (spec 006 research R3a). Committed = a suggestion drawn from the
// item's source turn has been accepted onto a meeting's agenda; anything else is only suggested.
export function itemCommitments(model: Model, suggestions: Suggestion[]) {
// `suggestionId` is the queue item to show for the action item: the accepted one, else the pending one.
  const out = new Map<string, { committed: string | null; suggested: string | null; suggestionId: string | null }>()
  for (const a of model.actionItems) {
    const mine = suggestions.filter((s) => s.id.endsWith(`:${a.topicKey}`) && s.sources.some((x) => x.turnId === a.sourceTurnId))
    const accepted = mine.find((s) => s.status === 'accepted')
    const pending = mine.find((s) => s.status === 'pending')
    out.set(a.id, {
      committed: accepted?.targetMeetingId ?? null,
      suggested: pending?.targetMeetingId ?? null,
      suggestionId: (accepted ?? pending)?.id ?? null,
    })
  }
  return out
}

export type ItemLine = {
  actionItemId: string
  themeId: string
  meetingId: string
  bead: Pt
  end: { kind: 'commit'; meetingId: string; path: string } | { kind: 'open'; path: string; mark: Pt }
}

// Action items as drawn: the dot sits at the meeting that raised the item. A committed item draws an
// arched line to the meeting whose agenda it is on; an uncommitted one a short diagonal stub (off the
// theme strand it would otherwise overlap) ending where the "?" mark goes. Nothing implies the item is
// due at the next meeting on its theme, which the data never says.
export function itemLines(model: Model, layout: Layout, suggestions: Suggestion[]): ItemLine[] {
  const commits = itemCommitments(model, suggestions)
  const out: ItemLine[] = []
  const seen = new Map<string, number>()
  for (const a of model.actionItems) {
    if (!a.themeId) continue
    const ti = model.themes.findIndex((t) => t.id === a.themeId)
    const key = keyFor(layout, a.meetingId, a.themeId)
    if (!key) continue
    const src = layout.get(key)!
    const slot = `${a.themeId}:${a.meetingId}`
    const n = seen.get(slot) ?? 0
    seen.set(slot, n + 1)
    const bead = { x: src.x + src.w + 7 + n * 11, y: strandY(src, ti, model.themes.length) }
    const target = commits.get(a.id)!.committed
    const tKey = target ? keyFor(layout, target, a.themeId) : undefined
    if (target && tKey) {
      const t = layout.get(tKey)!
      const p1 = { x: t.x - 2, y: strandY(t, ti, model.themes.length) }
      const dist = Math.abs(p1.x - bead.x)
      const dx = Math.max(20, dist / 3)
      const lift = Math.min(90, 18 + dist * 0.08)
      out.push({
        actionItemId: a.id, themeId: a.themeId, meetingId: a.meetingId, bead,
        end: { kind: 'commit', meetingId: target, path: `M${f(bead.x + 5)} ${f(bead.y)} C${f(bead.x + dx)} ${f(bead.y - lift)} ${f(p1.x - dx)} ${f(p1.y - lift)} ${f(p1.x)} ${f(p1.y)}` },
      })
    } else {
      out.push({
        actionItemId: a.id, themeId: a.themeId, meetingId: a.meetingId, bead,
        end: { kind: 'open', path: `M${f(bead.x + 4)} ${f(bead.y + 4)} L${f(bead.x + 17)} ${f(bead.y + 15)}`, mark: { x: bead.x + 23, y: bead.y + 20 } },
      })
    }
  }
  return out
}

// Theme pivot: a short dashed link between consecutive copies of the same meeting.
export function copyLinks(layout: Layout) {
  const byMeeting = new Map<string, Item[]>()
  for (const [k, it] of layout) if (k.includes('#')) byMeeting.set(it.meetingId, [...(byMeeting.get(it.meetingId) ?? []), it])
  const out: { id: string; meetingId: string; path: string }[] = []
  for (const [meetingId, copies] of byMeeting) {
    copies.sort((a, b) => a.y - b.y)
    for (let i = 1; i < copies.length; i++) {
      const a = copies[i - 1]
      const b = copies[i]
      const x = a.x + Math.min(a.w, b.w) / 2
      out.push({ id: `${meetingId}:${i}`, meetingId, path: `M${f(x)} ${f(a.y + a.h)} L${f(x)} ${f(b.y)}` })
    }
  }
  return out
}
