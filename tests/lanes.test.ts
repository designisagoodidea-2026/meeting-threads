import { describe, expect, it } from 'vitest'
import { orderLanes } from '../src/layout/lanes'
import { model, tinyModel } from './fixtures'

describe('orderLanes', () => {
  it('puts people who share many meetings next to each other', () => {
    const m = tinyModel([
      ...Array.from({ length: 5 }, (_, i) => ({ id: `ab${i}`, attendees: ['a', 'b'] })),
      { id: 'ac', attendees: ['a', 'c'] },
      { id: 'cd1', attendees: ['c', 'd'] },
      { id: 'cd2', attendees: ['c', 'd'] },
      { id: 'b-solo', attendees: ['b'] },
    ])
    const order = orderLanes(m.meetings, [...m.people.values()])
    const gap = (x: string, y: string) => Math.abs(order.indexOf(x) - order.indexOf(y))
    expect(gap('a', 'b')).toBe(1)
    expect(gap('c', 'd')).toBe(1)
  })

  it('never gives the lead a lane and leaves out people with no meetings', () => {
    const m = tinyModel([{ id: 'x', attendees: ['a'] }])
    m.people.set('idle', { id: 'idle', name: 'idle', role: '', discipline: 'design', isLead: false })
    expect(orderLanes(m.meetings, [...m.people.values()])).toEqual(['a'])
  })

  it('is deterministic on the full set and covers every non-lead attendee', () => {
    const m = model()
    const a = orderLanes(m.meetings, [...m.people.values()])
    expect(orderLanes(m.meetings, [...m.people.values()])).toEqual(a)
    const attendees = new Set(m.meetings.flatMap((x) => x.attendeeIds).filter((id) => id !== m.leadId))
    expect(new Set(a)).toEqual(attendees)
  })
})
