import { describe, expect, it } from 'vitest'
import { placeLabels, TIER_H } from '../src/layout/labels'
import { computeLayout } from '../src/layout/layouts'
import { model } from './fixtures'

const entry = (key: string, x: number, row = 'r', areaH = 100) => ({ key, row, x, areaY: 0, areaH })

describe('placeLabels', () => {
  it('keeps labels that do not collide on the first tier', () => {
    const out = placeLabels([entry('a', 0), entry('b', 200)], () => 100)
    expect(out.get('a')).toEqual({ dy: expect.any(Number), visible: true, tier: 0 })
    expect(out.get('b')!.tier).toBe(0)
  })

  it('moves a colliding label down a tier, and reuses freed tiers', () => {
    const out = placeLabels([entry('a', 0), entry('b', 50), entry('c', 120)], () => 100)
    expect(out.get('b')!.tier).toBe(1)
    expect(out.get('c')!.tier).toBe(0)
    expect(out.get('b')!.dy - out.get('a')!.dy).toBe(TIER_H)
  })

  it('hides a label when the area has no free tier left', () => {
    const out = placeLabels([entry('a', 0, 'r', TIER_H), entry('b', 10, 'r', TIER_H)], () => 100)
    expect(out.get('a')!.visible).toBe(true)
    expect(out.get('b')!.visible).toBe(false)
  })

  it('places each row on its own', () => {
    const out = placeLabels([entry('a', 0, 'r1'), entry('b', 10, 'r2')], () => 100)
    expect(out.get('b')!.tier).toBe(0)
  })

  it('shows every label in the meeting type view of the full set', () => {
    const lay = computeLayout(model(), 'type', { dayWidth: 600, height: 700 }).items
    const out = placeLabels(
      [...lay].map(([key, it]) => ({ key, row: it.label!.row, x: it.x, areaY: it.label!.y, areaH: it.label!.h })),
      () => 170,
    )
    expect([...out.values()].every((l) => l.visible)).toBe(true)
  })
})
