import { describe, expect, it } from 'vitest'
import { groupQueue, step } from '../src/threads/queue'
import { deriveSuggestions } from '../src/threads/suggestions'
import { model } from './fixtures'

describe('groupQueue', () => {
  const m = model()
  const all = deriveSuggestions(m, {})
  const accepted = all.find((s) => s.targetMeetingId)!
  const sug = deriveSuggestions(m, { [accepted.id]: { status: 'accepted', at: '' }, [all.filter((s) => s.targetMeetingId)[1].id]: { status: 'dismissed', at: '' } })
  const groups = groupQueue(m, sug)
  it('groups targeted items by meeting in time order, then the ones needing their own meeting', () => {
    const targeted = groups.filter((g) => g.meetingId)
    const starts = targeted.map((g) => +m.meetingById.get(g.meetingId!)!.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(groups.at(-1)!.meetingId).toBeNull()
    for (const g of targeted) for (const s of g.items) expect(s.targetMeetingId).toBe(g.meetingId)
  })
  it('keeps accepted items in their group, leaves dismissed ones out, and counts what is left to review', () => {
    const items = groups.flatMap((g) => g.items)
    expect(items.some((s) => s.id === accepted.id)).toBe(true)
    expect(items.some((s) => s.status === 'dismissed')).toBe(false)
    const g = groups.find((x) => x.meetingId === accepted.targetMeetingId)!
    expect(g.toReview).toBe(g.items.filter((s) => s.status === 'pending').length)
    expect(items.length).toBe(sug.filter((s) => s.status !== 'dismissed').length)
  })
})

describe('step', () => {
  const ids = ['a', 'b', 'c']
  it('moves down and up, stopping at the ends, and starts at the top', () => {
    expect(step(ids, null, 1)).toBe('a')
    expect(step(ids, 'a', 1)).toBe('b')
    expect(step(ids, 'c', 1)).toBe('c')
    expect(step(ids, 'a', -1)).toBe('a')
    expect(step(ids, 'zzz', 1)).toBe('a')
    expect(step([], null, 1)).toBeNull()
  })
})
