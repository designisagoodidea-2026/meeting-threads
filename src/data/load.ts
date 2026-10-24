import {
  DISCIPLINES,
  MEETING_TYPES,
  type ActionItem,
  type AnnotationsFile,
  type CalendarFile,
  type Discipline,
  type Meeting,
  type MeetingType,
  type Model,
  type Person,
  type Theme,
  type TranscriptFile,
  type Turn,
} from './types'

// Thrown at load so a bad file shows up on screen, naming what to fix, instead of an empty calendar.
export class DataError extends Error {
  constructor(
    public file: string,
    public recordId: string,
    public field: string,
    detail: string,
  ) {
    super(`${file} › ${recordId} › ${field}: ${detail}`)
    this.name = 'DataError'
  }
}

const CAL = 'calendar.json'
const ANN = 'annotations.json'

// 'YYYY-MM-DD' of a date as seen in the calendar's time zone.
// Building an Intl formatter is slow, and layout asks for every meeting's day and time on each pivot.
const formatters = new Map<string, Intl.DateTimeFormat>()
const fmt = (key: string, make: () => Intl.DateTimeFormat) => formatters.get(key) ?? formatters.set(key, make()).get(key)!

export function localDate(d: Date, timeZone: string): string {
  return fmt(`d:${timeZone}`, () => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })).format(d)
}

// Minutes since local midnight in the calendar's time zone.
export function localMinutes(d: Date, timeZone: string): number {
  const parts = fmt(`m:${timeZone}`, () => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return get('hour') * 60 + get('minute')
}

function workingDays(start: string, end: string): string[] {
  const days: string[] = []
  for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export function buildModel(
  calendar: CalendarFile,
  transcripts: Record<string, TranscriptFile>,
  annotations: AnnotationsFile,
): Model {
  const tz = calendar.timeZone
  const days = workingDays(annotations.window.start, annotations.window.end)
  const daySet = new Set(days)

  const people = new Map<string, Person>()
  for (const p of annotations.people) {
    if (!(DISCIPLINES as readonly string[]).includes(p.discipline))
      throw new DataError(ANN, p.id, 'people.discipline', `unknown discipline "${p.discipline}"`)
    people.set(p.id, { id: p.id, name: p.name ?? p.id, role: p.role, discipline: p.discipline as Discipline, isLead: false })
  }
  const themeIds = new Set(annotations.themes.map((t) => t.id))

  const leads = new Set<string>()
  const meetings: Meeting[] = []
  for (const ev of calendar.items) {
    if (!ev.start.dateTime || !ev.end.dateTime) continue // all-day events are skipped
    const attendees = ev.attendees ?? []
    for (const a of attendees) {
      const p = people.get(a.email)
      if (!p) throw new DataError(CAL, ev.id, 'attendees.email', `"${a.email}" is not in annotations.people`)
      if (a.displayName) p.name = a.displayName
      if (a.self) leads.add(a.email)
    }
    const start = new Date(ev.start.dateTime)
    if (!daySet.has(localDate(start, tz)))
      throw new DataError(CAL, ev.id, 'start.dateTime', `${ev.start.dateTime} is outside the window`)

    const ann = annotations.meetings[ev.id]
    if (!ann || !(MEETING_TYPES as readonly string[]).includes(ann.type))
      throw new DataError(ANN, ev.id, 'meetings.type', `unknown or missing type "${ann?.type}"`)
    for (const th of ann.themeIds)
      if (!themeIds.has(th)) throw new DataError(ANN, ev.id, 'meetings.themeIds', `unknown theme "${th}"`)

    const agenda = (ev.description ?? '')
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => ({ text: l.slice(2).trim(), origin: 'seeded' as const }))

    let transcript: Turn[] | null = null
    const tr = transcripts[ev.id]
    if (tr) {
      const map = annotations.speakerMap[ev.id] ?? {}
      for (const [label, pid] of Object.entries(map))
        if (!people.has(pid)) throw new DataError(ANN, ev.id, 'speakerMap', `${label} maps to unknown person "${pid}"`)
      transcript = tr.segments.map((s) => ({
        id: `${ev.id}#${s.id}`,
        meetingId: ev.id,
        speakerId: map[s.speaker] ?? null,
        offsetMs: s.startMs,
        text: s.text,
      }))
    }

    meetings.push({
      id: ev.id,
      title: ev.summary,
      start,
      end: new Date(ev.end.dateTime),
      type: ann.type as MeetingType,
      attendeeIds: attendees.map((a) => a.email),
      themeIds: [...ann.themeIds],
      agenda,
      transcript,
    })
  }
  if (leads.size !== 1)
    throw new DataError(CAL, '*', 'attendees.self', `expected exactly one lead (self: true), found ${leads.size}`)
  const leadId = [...leads][0]
  people.get(leadId)!.isLead = true

  meetings.sort((a, b) => +a.start - +b.start)
  const meetingById = new Map(meetings.map((m) => [m.id, m]))
  const turnMeeting = new Map<string, string>()
  for (const m of meetings) for (const t of m.transcript ?? []) turnMeeting.set(t.id, m.id)

  const projects = (annotations.projects ?? []).map((p) => {
    for (const th of p.themeIds) if (!themeIds.has(th)) throw new DataError(ANN, p.id, 'projects.themeIds', `unknown theme "${th}"`)
    return { id: p.id, name: p.name, themeIds: [...p.themeIds] }
  })
  const themes: Theme[] = annotations.themes.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    meetingIds: meetings.filter((m) => m.themeIds.includes(t.id)).map((m) => m.id),
    turnIds: t.mentions.filter((id) => turnMeeting.has(id)),
    projectIds: projects.filter((p) => p.themeIds.includes(t.id)).map((p) => p.id),
  }))

  const actionItems: ActionItem[] = annotations.actionItems.map((a) => {
    if (!meetingById.has(a.meetingId)) throw new DataError(ANN, a.id, 'actionItems.meetingId', `unknown meeting "${a.meetingId}"`)
    if (turnMeeting.get(a.sourceTurnId) !== a.meetingId)
      throw new DataError(ANN, a.id, 'actionItems.sourceTurnId', `"${a.sourceTurnId}" is not a turn in ${a.meetingId}`)
    if (!people.has(a.ownerId)) throw new DataError(ANN, a.id, 'actionItems.ownerId', `unknown person "${a.ownerId}"`)
    if (a.themeId !== null && !themeIds.has(a.themeId))
      throw new DataError(ANN, a.id, 'actionItems.themeId', `unknown theme "${a.themeId}"`)
    if (a.status !== 'open' && a.status !== 'done') throw new DataError(ANN, a.id, 'actionItems.status', `"${a.status}"`)
    return { ...a, status: a.status }
  })

  return { timeZone: tz, days, people, leadId, meetings, meetingById, themes, projects, actionItems }
}

// Browser entry: the bundled synthetic set. Swapping in real exports means replacing these files.
export async function loadModel(): Promise<Model> {
  const calendar = (await import('../../data/calendar.json')).default as CalendarFile
  const annotations = (await import('../../data/annotations.json')).default as AnnotationsFile
  const files = import.meta.glob<{ default: TranscriptFile }>('../../data/transcripts/*.json', { eager: true })
  const transcripts: Record<string, TranscriptFile> = {}
  for (const f of Object.values(files)) transcripts[f.default.eventId] = f.default
  return buildModel(calendar, transcripts, annotations)
}
