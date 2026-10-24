import type { Meeting, Person } from '../data/types'

// People pivot lane order (research R4): a greedy chain where each next lane is the person who
// shares the most meetings with the previous one. Ties go to more meetings overall, then name.
// The lead attends everything, so they get no lane.
export function orderLanes(meetings: Meeting[], people: Person[]): string[] {
  const lead = new Set(people.filter((p) => p.isLead).map((p) => p.id))
  const total = new Map<string, number>()
  const co = new Map<string, number>()
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  for (const m of meetings) {
    const ids = m.attendeeIds.filter((id) => !lead.has(id))
    for (const a of ids) total.set(a, (total.get(a) ?? 0) + 1)
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) co.set(pair(ids[i], ids[j]), (co.get(pair(ids[i], ids[j])) ?? 0) + 1)
  }
  const byTotalThenName = (a: string, b: string) => total.get(b)! - total.get(a)! || a.localeCompare(b)
  const left = [...total.keys()].sort(byTotalThenName)
  const order: string[] = []
  while (left.length) {
    const last = order[order.length - 1]
    let best = 0
    if (last)
      for (let i = 1; i < left.length; i++) {
        const d = (co.get(pair(last, left[i])) ?? 0) - (co.get(pair(last, left[best])) ?? 0)
        if (d > 0) best = i // `left` is pre-sorted, so the first maximum already wins ties
      }
    order.push(left.splice(best, 1)[0])
  }
  return order
}
