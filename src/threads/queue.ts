import type { Model, Suggestion } from '../data/types'

// The queue, grouped by the meeting each item would land on, so a lead prepares one agenda at a time.
// Dismissed items live in their own collapsed list; items needing their own meeting come last.
export type QueueGroup = { meetingId: string | null; items: Suggestion[]; toReview: number }

export function groupQueue(model: Model, suggestions: Suggestion[]): QueueGroup[] {
  const byMeeting = new Map<string | null, Suggestion[]>()
  for (const s of suggestions) {
    if (s.status === 'dismissed') continue
    const k = s.targetMeetingId
    byMeeting.set(k, [...(byMeeting.get(k) ?? []), s])
  }
  const start = (id: string | null) => (id ? +model.meetingById.get(id)!.start : Infinity)
  return [...byMeeting.entries()]
    .sort(([a], [b]) => start(a) - start(b))
    .map(([meetingId, items]) => ({ meetingId, items, toReview: items.filter((s) => s.status === 'pending').length }))
}

// Keyboard movement through the queue: one step, stopping at the ends; from nowhere, the top.
export function step(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null
  const i = current ? ids.indexOf(current) : -1
  if (i < 0) return ids[0]
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))]
}
