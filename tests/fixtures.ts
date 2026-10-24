import { readFileSync, readdirSync } from 'node:fs'
import type { AnnotationsFile, CalendarFile, TranscriptFile } from '../src/data/types'

const read = (p: string) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'))

// Fresh deep copies each call, so a test can mutate them.
export function rawData() {
  const calendar: CalendarFile = read('calendar.json')
  const annotations: AnnotationsFile = read('annotations.json')
  const transcripts: Record<string, TranscriptFile> = {}
  for (const f of readdirSync(new URL('../data/transcripts', import.meta.url))) {
    const t: TranscriptFile = read(`transcripts/${f}`)
    transcripts[t.eventId] = t
  }
  return { calendar, annotations, transcripts }
}

import { buildModel } from '../src/data/load'
import type { Meeting, Model, Person } from '../src/data/types'

export function model(): Model {
  const { calendar, annotations, transcripts } = rawData()
  return buildModel(calendar, transcripts, annotations)
}

// A hand-built model for small, exact cases.
export function tinyModel(meetings: { id: string; attendees: string[]; day?: number; hour?: number; themes?: string[] }[]): Model {
  const ids = new Set(['lead', ...meetings.flatMap((m) => m.attendees)])
  const people = new Map<string, Person>(
    [...ids].map((id) => [id, { id, name: id, role: '', discipline: 'design', isLead: id === 'lead' }]),
  )
  const ms: Meeting[] = meetings.map((m, i) => {
    const start = new Date(Date.UTC(2026, 10, 2 + (m.day ?? 0), 17 + (m.hour ?? i % 6)))
    return {
      id: m.id, title: m.id, start, end: new Date(+start + 30 * 60e3), type: 'team-sync',
      attendeeIds: ['lead', ...m.attendees], themeIds: m.themes ?? [], agenda: [], transcript: null,
    }
  })
  ms.sort((a, b) => +a.start - +b.start)
  const themeIds = [...new Set(meetings.flatMap((m) => m.themes ?? []))]
  return {
    timeZone: 'America/Los_Angeles',
    days: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
    people, leadId: 'lead', meetings: ms, meetingById: new Map(ms.map((m) => [m.id, m])),
    themes: themeIds.map((id) => ({ id, name: id, color: 'teal', meetingIds: ms.filter((m) => m.themeIds.includes(id)).map((m) => m.id), turnIds: [], projectIds: [] })),
    projects: [],
    actionItems: [],
  }
}
