import { describe, expect, it } from 'vitest'
import { applyCustom } from '../src/data/custom'
import { MEETING_TYPES } from '../src/data/types'
import { computeLayout } from '../src/layout/layouts'
import { createStore } from '../src/store'
import { model } from './fixtures'

const vp = { dayWidth: 200, height: 600 }

describe('applyCustom', () => {
  const m = model()
  it('leaves the model alone when nothing is customized', () => {
    expect(applyCustom(m, undefined)).toBe(m)
    expect(m.typeOrder).toEqual([...MEETING_TYPES])
    expect(m.typeLabels['one-on-one']).toBe('1:1')
  })
  it('renames projects, themes and meeting types, and a blank name falls back to the original', () => {
    const c = applyCustom(m, {
      labels: { project: { [m.projects[0].id]: 'Launch' }, theme: { [m.themes[0].id]: 'First-run', [m.themes[1].id]: '   ' }, type: { 'design-crit': 'Critique' } },
      order: { project: [], theme: [], type: [] },
    })
    expect(c.projects[0].name).toBe('Launch')
    expect(c.themes[0].name).toBe('First-run')
    expect(c.themes[1].name).toBe(m.themes[1].name)
    expect(c.typeLabels['design-crit']).toBe('Critique')
    expect(m.projects[0].name).not.toBe('Launch') // the input model is untouched
  })
  it('reorders by the saved order, ignoring unknown ids and keeping unlisted ones after, in their original order', () => {
    const t = m.themes.map((x) => x.id)
    const c = applyCustom(m, {
      labels: { project: {}, theme: {}, type: {} },
      order: { project: [m.projects.at(-1)!.id, 'gone'], theme: [t[2], t[0]], type: ['external', 'one-on-one'] },
    })
    expect(c.projects[0].id).toBe(m.projects.at(-1)!.id)
    expect(c.projects).toHaveLength(m.projects.length)
    expect(c.themes.map((x) => x.id)).toEqual([t[2], t[0], ...t.filter((x) => x !== t[2] && x !== t[0])])
    expect(c.typeOrder.slice(0, 2)).toEqual(['external', 'one-on-one'])
    expect(c.typeOrder).toHaveLength(MEETING_TYPES.length)
  })
  it('drives the row order and labels of the project, type and theme views', () => {
    const c = applyCustom(m, {
      labels: { project: {}, theme: {}, type: { interview: 'Hiring loop' } },
      order: { project: [m.projects[2].id], theme: [m.themes[3].id], type: ['interview'] },
    })
    expect(computeLayout(c, 'project', vp).rows[0].key).toBe(m.projects[2].id)
    expect(computeLayout(c, 'theme', vp).rows[0].key).toBe(m.themes[3].id)
    expect(computeLayout(c, 'type', vp).rows[0]).toMatchObject({ key: 'interview', label: 'Hiring loop' })
  })
})

describe('reset', () => {
  it('returns the store to a first visit', () => {
    const mem = new Map<string, string>()
    const s = createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) })
    s.update((x) => ({ ...x, guideDone: true, decisions: { a: { status: 'accepted', at: '' } }, custom: { labels: { project: { p: 'x' }, theme: {}, type: {} }, order: { project: [], theme: [], type: [] } } }))
    s.reset()
    expect(s.state).toEqual({ version: 1, notes: [], decisions: {}, privacy: { hiddenMeetingIds: [], excludedPersonIds: [] } })
    expect(JSON.parse(mem.get('meeting-threads:v1')!)).toEqual(s.state)
  })
})
