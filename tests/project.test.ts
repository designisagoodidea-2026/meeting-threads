import { describe, expect, it } from 'vitest'
import { projectSummary } from '../src/threads/project'
import { deriveSuggestions } from '../src/threads/suggestions'
import { model } from './fixtures'

describe('projectSummary (FR-039)', () => {
  const m = model()
  const sug = deriveSuggestions(m, {})
  const p = m.projects[0]
  const s = projectSummary(m, p.id, sug, new Set())
  const inProject = (meetingThemes: string[]) => p.themeIds.some((t) => meetingThemes.includes(t))
  it('lists every meeting that touches one of its themes, in time order', () => {
    expect(s.meetings.map((x) => x.id)).toEqual(m.meetings.filter((x) => inProject(x.themeIds)).map((x) => x.id))
  })
  it('lists its themes in the canvas order', () => {
    expect(s.themes.map((t) => t.id)).toEqual(m.themes.filter((t) => p.themeIds.includes(t.id)).map((t) => t.id))
  })
  it('counts people by the project meetings they attend, the lead left out, most first', () => {
    const counts = s.people.map((x) => x.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(s.people.some((x) => x.personId === m.leadId)).toBe(false)
    const first = s.people[0]
    expect(first.count).toBe(s.meetings.filter((x) => x.attendeeIds.includes(first.personId)).length)
  })
  it('gathers action items and suggestions on its themes, each once', () => {
    expect(s.actionItems.map((a) => a.item.id).sort()).toEqual(m.actionItems.filter((a) => a.themeId && p.themeIds.includes(a.themeId)).map((a) => a.id).sort())
    const ids = s.suggestions.pending.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })
  it('throws on an unknown project', () => expect(() => projectSummary(m, 'nope', sug, new Set())).toThrow())
})
