import { describe, expect, it } from 'vitest'
import { interpolate, itemProgress, lift, MAX_DELAY } from '../src/layout/tween'
import type { Layout } from '../src/layout/layouts'

const box = (meetingId: string, x: number, y: number, z = 0) => ({ meetingId, x, y, w: 10, h: 10, z })

describe('interpolate', () => {
  const from: Layout = new Map([['a', box('a', 0, 0)], ['b', box('b', 100, 0)]])
  const to: Layout = new Map([['a', box('a', 0, 200)], ['b#t1', box('b', 100, 50)], ['b#t2', box('b', 100, 300)]])

  it('equals from at p=0 and to at p=1', () => {
    const start = interpolate(from, to, 0)
    expect(start.get('a')).toMatchObject({ x: 0, y: 0 })
    const end = interpolate(from, to, 1)
    for (const [k, v] of to) expect(end.get(k)).toMatchObject({ x: v.x, y: v.y, w: v.w, h: v.h })
  })

  it('starts keys only in "to" from their meeting box in "from"', () => {
    const start = interpolate(from, to, 0)
    expect(start.get('b#t1')).toMatchObject({ x: 100, y: 0 })
    expect(start.get('b#t2')).toMatchObject({ x: 100, y: 0 })
  })

  it('ends keys only in "from" at their meeting box in "to"', () => {
    const back = interpolate(to, from, 1)
    expect(back.get('b#t2')).toMatchObject({ x: 100, y: 0 })
    expect(back.get('b')).toMatchObject({ x: 100, y: 0 })
  })

  it('carries z from a mid-flight snapshot down to zero', () => {
    const mid: Layout = new Map([['a', box('a', 0, 0, 40)]])
    expect(interpolate(mid, from, 0).get('a')!.z).toBe(40)
    expect(interpolate(mid, from, 1).get('a')!.z).toBe(0)
  })
})

describe('lift and delays', () => {
  it('lift is zero at both ends and peaks in the middle', () => {
    expect(lift(0).z).toBeCloseTo(0)
    expect(lift(1).z).toBeCloseTo(0)
    expect(lift(0.5).z).toBeGreaterThan(lift(0.25).z)
    expect(lift(0.5).z).toBeGreaterThan(lift(0.75).z)
    expect(lift(0).scale).toBeCloseTo(1)
  })

  it('a delayed item starts later but still finishes at p=1', () => {
    expect(itemProgress(0.05, MAX_DELAY)).toBe(0)
    expect(itemProgress(1, MAX_DELAY)).toBe(1)
    expect(itemProgress(1, 0)).toBe(1)
    expect(itemProgress(0.5, 0)).toBeGreaterThan(itemProgress(0.5, MAX_DELAY))
  })
})
