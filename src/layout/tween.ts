import type { Item, Layout } from './layouts'

// One shared progress value p (0 to 1) drives every block and, later, every thread (research R1).
// Each item starts up to MAX_DELAY later, by time position, so meetings peel off left to right (R2).
export const DURATION = 0.82 // seconds, including the stagger
export const MAX_DELAY = 0.12 / DURATION

const clamp = (v: number) => Math.min(1, Math.max(0, v))
export const itemProgress = (p: number, delay: number) => clamp((p - delay) / (1 - MAX_DELAY))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Keys present on only one side borrow their meeting's box from the other side, so theme copies
// fan out of their single-row block and fold back into it.
export function interpolate(from: Layout, to: Layout, p: number, delayOf?: (key: string) => number): Layout {
  const first = (l: Layout) => {
    const byMeeting = new Map<string, Item>()
    for (const it of l.values()) if (!byMeeting.has(it.meetingId)) byMeeting.set(it.meetingId, it)
    return byMeeting
  }
  const fromBy = first(from)
  const toBy = first(to)
  const out: Layout = new Map()
  for (const key of new Set([...from.keys(), ...to.keys()])) {
    const ref = (to.get(key) ?? from.get(key))!
    const a = from.get(key) ?? fromBy.get(ref.meetingId) ?? ref
    const b = to.get(key) ?? toBy.get(ref.meetingId) ?? ref
    const t = ease(itemProgress(p, delayOf?.(key) ?? 0))
    out.set(key, {
      meetingId: ref.meetingId,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t),
      z: lerp(a.z ?? 0, b.z ?? 0, t),
      segments: b.segments,
      label: b.label,
      themes: ref.themes,
      t,
    })
  }
  return out
}

// The 2.5D lift: up toward the viewer mid-flight, settled at both ends.
export function lift(t: number) {
  const s = Math.sin(Math.PI * t)
  return { z: 70 * s, scale: 1 + 0.035 * s, shadow: s }
}
