import { describe, expect, it } from 'vitest'
import { applyPrivacy } from '../src/data/privacy'
import { deriveSuggestions } from '../src/threads/suggestions'
import { themeSummary } from '../src/threads/theme'
import { model } from './fixtures'

const RETEST = 'evt_20261104_1000:retest-progress-meter'

describe('themeSummary', () => {
  const m = model()
  const sugs = deriveSuggestions(m, { [RETEST]: { status: 'accepted', at: 'x' } })
  const s = themeSummary(m, 'onboarding', sugs, new Set())
  const theme = m.themes.find((t) => t.id === 'onboarding')!

  it('lists the theme meetings in time order', () => {
    expect(s.meetings.map((x) => x.id)).toEqual(theme.meetingIds)
  })

  it('counts contributors by mentioning turns, most first then by name', () => {
    const turns = m.meetings.flatMap((x) => x.transcript ?? []).filter((t) => theme.turnIds.includes(t.id))
    expect(s.contributors.reduce((n, c) => n + c.count, 0)).toBe(turns.length)
    const name = (id: string | null) => (id ? m.people.get(id)!.name : 'Unknown speaker')
    for (let i = 1; i < s.contributors.length; i++) {
      const [a, b] = [s.contributors[i - 1], s.contributors[i]]
      expect(a.count > b.count || (a.count === b.count && name(a.personId).localeCompare(name(b.personId)) <= 0)).toBe(true)
    }
  })

  it('groups unknown speakers into one row', () => {
    const crit = m.themes.find((t) => t.id === 'crit-ritual')!
    const cs = themeSummary(m, crit.id, sugs, new Set()).contributors
    expect(cs.filter((c) => c.personId === null)).toHaveLength(1)
  })

  it('has a mentions row for every theme meeting, with a gap reason when it has no turns', () => {
    expect(s.mentions.map((x) => x.meetingId)).toEqual(theme.meetingIds)
    for (const row of s.mentions) {
      if (row.turns.length) expect(row.gap).toBeNull()
      else expect(['hidden', 'not-recorded', 'no-mention']).toContain(row.gap)
      for (const t of row.turns) expect(theme.turnIds).toContain(t.id)
    }
  })

  it('lists exactly the action items on the theme', () => {
    expect(s.actionItems.map((x) => x.item.id).sort()).toEqual(m.actionItems.filter((a) => a.themeId === 'onboarding').map((a) => a.id).sort())
  })

  it('splits suggestions into pending and accepted, covering theme follow-ups and items on the theme', () => {
    expect(s.suggestions.accepted.map((x) => x.id)).toContain(RETEST)
    expect(s.suggestions.pending.every((x) => x.status === 'pending')).toBe(true)
    const all = [...s.suggestions.pending, ...s.suggestions.accepted]
    expect(all.some((x) => x.id.endsWith(':onboarding'))).toBe(true)
    expect(all.some((x) => !x.id.endsWith(':onboarding'))).toBe(true)
  })

  it('throws on an unknown id', () => {
    expect(() => themeSummary(m, 'nope', sugs, new Set())).toThrow()
  })

  it('privacy: a hidden meeting quotes nothing and says why; an excluded person is still a contributor', () => {
    const CRIT = 'evt_20261102_1100'
    const LENA = 'lena@northwind.example'
    const p = applyPrivacy(m, { hiddenMeetingIds: [CRIT], excludedPersonIds: [LENA] })
    for (const t of p.themes) {
      const ts = themeSummary(p, t.id, deriveSuggestions(p, {}), new Set())
      expect(ts.mentions.flatMap((x) => x.turns).some((tu) => tu.id.startsWith(`${CRIT}#`))).toBe(false)
      const row = ts.mentions.find((x) => x.meetingId === CRIT)
      if (row) expect(row.gap).toBe('hidden')
    }
    const ds = themeSummary(p, 'ds-debt', deriveSuggestions(p, {}), new Set())
    expect(ds.contributors.some((c) => c.personId === LENA)).toBe(true)
  })
})
