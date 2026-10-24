// Horizontal title labels. A label starts at its block's left edge and may run past it to the right,
// so labels that would overlap within a row drop to the next tier down (greedy, left to right).
// A label with no free tier inside its area is hidden; the block's tooltip still has the title.
export const TIER_H = 19
const GAP = 6

export type LabelEntry = { key: string; row: string; x: number; areaY: number; areaH: number }
export type Placed = { dy: number; visible: boolean; tier: number }

export function placeLabels(entries: LabelEntry[], widthOf: (key: string) => number): Map<string, Placed> {
  const out = new Map<string, Placed>()
  const ends = new Map<string, number[]>() // per row: right edge of the last label on each tier
  for (const e of [...entries].sort((a, b) => a.x - b.x)) {
    const tiers = ends.get(e.row) ?? []
    ends.set(e.row, tiers)
    const max = Math.max(1, Math.floor((e.areaH - 2) / TIER_H))
    let tier = tiers.findIndex((end) => end + GAP <= e.x)
    if (tier === -1) tier = tiers.length
    const visible = tier < max
    if (visible) tiers[tier] = e.x + widthOf(e.key)
    out.set(e.key, { dy: e.areaY + 2 + Math.min(tier, max - 1) * TIER_H, visible, tier })
  }
  return out
}
