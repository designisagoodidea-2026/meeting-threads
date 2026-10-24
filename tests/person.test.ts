import { describe, expect, it } from 'vitest'
import { personSummary } from '../src/threads/person'
import { model } from './fixtures'

const PRIYA = 'priya@northwind.example'

describe('personSummary', () => {
  const m = model()
  const s = personSummary(m, PRIYA)

  it('lists every meeting shared with the lead, in time order', () => {
    const want = m.meetings.filter((x) => x.attendeeIds.includes(PRIYA)).map((x) => x.id)
    expect(s.meetings.map((x) => x.meeting.id)).toEqual(want)
  })

  it("keeps only the person's and the lead's turns, grouped by meeting", () => {
    for (const row of s.meetings) {
      for (const t of row.turns) expect([PRIYA, m.leadId]).toContain(t.speakerId)
      const all = (row.meeting.transcript ?? []).filter((t) => t.speakerId === PRIYA || t.speakerId === m.leadId)
      expect(row.turns).toEqual(all)
    }
    expect(s.meetings.some((r) => r.turns.length > 0)).toBe(true)
  })

  it('lists open action items the person owns, each with its next meeting or none', () => {
    const owned = m.actionItems.filter((a) => a.ownerId === PRIYA && a.status === 'open')
    const items = s.open.filter((o) => o.kind === 'action')
    expect(items.map((o) => o.id).sort()).toEqual(owned.map((a) => a.id).sort())
    for (const o of items) {
      const a = owned.find((x) => x.id === o.id)!
      const next = m.meetings.find((x) => +x.start > +m.meetingById.get(a.meetingId)!.start && x.attendeeIds.includes(PRIYA))
      expect(o.nextMeetingId).toBe(next?.id ?? null)
    }
  })

  it('lists the themes the person spoke about, headed for their next meeting on that theme', () => {
    const themes = s.open.filter((o) => o.kind === 'theme')
    expect(themes.length).toBeGreaterThan(0)
    for (const o of themes) {
      const t = m.themes.find((x) => x.id === o.id)!
      const spoke = m.meetings.filter((x) => x.transcript?.some((tu) => tu.speakerId === PRIYA && t.turnIds.includes(tu.id)))
      expect(spoke.length).toBeGreaterThan(0)
      const last = spoke[spoke.length - 1]
      const next = m.meetings.find((x) => +x.start > +last.start && x.attendeeIds.includes(PRIYA) && x.themeIds.includes(t.id))
      expect(o.nextMeetingId).toBe(next?.id ?? null)
    }
  })

  it('excludes action items already on an agenda', () => {
    const owned = m.actionItems.filter((a) => a.ownerId === PRIYA)
    const done = new Set([owned[0].id])
    expect(personSummary(m, PRIYA, done).open.some((o) => o.id === owned[0].id)).toBe(false)
  })
})
