import { describe, expect, it } from 'vitest'
import { buildModel, DataError } from '../src/data/load'
import { rawData } from './fixtures'

function expectDataError(fn: () => unknown, file: string, recordId: string, field: string) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DataError)
    expect(e).toMatchObject({ file, recordId, field })
    expect((e as Error).message).toContain(field)
    return
  }
  throw new Error('expected a DataError')
}

describe('buildModel', () => {
  it('loads the generated set', () => {
    const { calendar, annotations, transcripts } = rawData()
    const m = buildModel(calendar, transcripts, annotations)
    expect(m.meetings).toHaveLength(calendar.items.length)
    expect(m.people.get(m.leadId)?.isLead).toBe(true)
    expect(m.days).toHaveLength(10)
    // sorted by start, themes sorted by start
    for (let i = 1; i < m.meetings.length; i++) expect(+m.meetings[i].start).toBeGreaterThanOrEqual(+m.meetings[i - 1].start)
    const t = m.themes.find((t) => t.id === 'onboarding')!
    const starts = t.meetingIds.map((id) => +m.meetingById.get(id)!.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('maps speakers, leaving unmapped ones null', () => {
    const { calendar, annotations, transcripts } = rawData()
    const m = buildModel(calendar, transcripts, annotations)
    const turns = m.meetings.flatMap((x) => x.transcript ?? [])
    expect(turns.some((t) => t.speakerId === null)).toBe(true)
    expect(turns.filter((t) => t.speakerId).every((t) => m.people.has(t.speakerId!))).toBe(true)
  })

  it('turns description bullets into seeded agenda items and skips all-day events', () => {
    const { calendar, annotations, transcripts } = rawData()
    calendar.items.push({ id: 'allday', summary: 'Holiday', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } })
    const m = buildModel(calendar, transcripts, annotations)
    expect(m.meetingById.has('allday')).toBe(false)
    const withAgenda = m.meetings.find((x) => x.agenda.length > 0)!
    expect(withAgenda.agenda[0].origin).toBe('seeded')
  })

  it('rejects an unknown attendee', () => {
    const d = rawData()
    const ev = d.calendar.items[0]
    ev.attendees!.push({ email: 'stranger@nowhere.example' })
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'calendar.json', ev.id, 'attendees.email')
  })

  it('rejects zero leads and two leads', () => {
    const none = rawData()
    for (const ev of none.calendar.items) for (const a of ev.attendees!) delete a.self
    expectDataError(() => buildModel(none.calendar, none.transcripts, none.annotations), 'calendar.json', '*', 'attendees.self')
    const two = rawData()
    two.calendar.items[0].attendees![1].self = true
    expectDataError(() => buildModel(two.calendar, two.transcripts, two.annotations), 'calendar.json', '*', 'attendees.self')
  })

  it('rejects an unknown meeting type', () => {
    const d = rawData()
    const id = d.calendar.items[3].id
    d.annotations.meetings[id].type = 'standup'
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'annotations.json', id, 'meetings.type')
  })

  it('rejects an action item whose source turn is in another meeting', () => {
    const d = rawData()
    const [a, b] = d.annotations.actionItems
    const other = d.annotations.actionItems.find((x) => x.meetingId !== a.meetingId) ?? b
    a.sourceTurnId = other.sourceTurnId
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'annotations.json', a.id, 'actionItems.sourceTurnId')
  })

  it('rejects an unknown theme id', () => {
    const d = rawData()
    const id = d.calendar.items[0].id
    d.annotations.meetings[id].themeIds.push('nope')
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'annotations.json', id, 'meetings.themeIds')
  })

  it('loads projects, each with several themes, and lets a theme belong to more than one project', () => {
    const { calendar, annotations, transcripts } = rawData()
    const m = buildModel(calendar, transcripts, annotations)
    expect(m.projects.length).toBeGreaterThanOrEqual(4)
    expect(m.projects.some((p) => p.themeIds.length > 1)).toBe(true)
    const shared = m.themes.filter((t) => m.projects.filter((p) => p.themeIds.includes(t.id)).length > 1)
    expect(shared.length).toBeGreaterThan(0)
    for (const t of m.themes) expect(t.projectIds).toEqual(m.projects.filter((p) => p.themeIds.includes(t.id)).map((p) => p.id))
  })

  it('keeps themes and projects distinct: no theme named like a project, several themes per project, several projects per theme', () => {
    const { calendar, annotations, transcripts } = rawData()
    const m = buildModel(calendar, transcripts, annotations)
    const words = (x: string) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
    for (const t of m.themes)
      for (const p of m.projects) {
        const shared = [...words(t.name)].filter((w) => words(p.name).has(w))
        expect(shared, `theme "${t.name}" vs project "${p.name}"`).toEqual([])
      }
    for (const p of m.projects) expect(p.themeIds.length, p.name).toBeGreaterThanOrEqual(2)
    for (const t of m.themes) expect(t.projectIds.length, t.name).toBeGreaterThanOrEqual(2)
  })

  it('rejects a project naming an unknown theme', () => {
    const d = rawData()
    d.annotations.projects[0].themeIds.push('nope')
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'annotations.json', d.annotations.projects[0].id, 'projects.themeIds')
  })

  it('rejects a meeting outside the window', () => {
    const d = rawData()
    const ev = d.calendar.items[0]
    ev.start.dateTime = '2026-10-30T10:00:00-07:00'
    ev.end.dateTime = '2026-10-30T10:30:00-07:00'
    expectDataError(() => buildModel(d.calendar, d.transcripts, d.annotations), 'calendar.json', ev.id, 'start.dateTime')
  })
})
