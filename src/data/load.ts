import {
  DISCIPLINES,
  MEETING_TYPES,
  TYPE_LABELS,
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
  now?: Date, // when given, meetings that start after it are upcoming
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
      upcoming: now ? +start > +now : false,
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

  return { timeZone: tz, days, people, leadId, meetings, meetingById, themes, projects, actionItems, typeLabels: { ...TYPE_LABELS }, typeOrder: [...MEETING_TYPES], now }
}

// The UTC instant of a local wall-clock time in a zone, daylight saving included.
export function zoned(day: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = day.split('-').map(Number)
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60)
  const offset = (t: number) => {
    const p = fmt(`z:${timeZone}`, () => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })).formatToParts(new Date(t))
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t
  }
  const first = wall - offset(wall)
  return new Date(wall - offset(first))
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())

// A dragged meeting: which day of the window and its local start and end, in minutes (FR-038).
export type TimeOverride = { day: number; start: number; end: number }
type Files = { calendar: CalendarFile; transcripts: Record<string, TranscriptFile>; annotations: AnnotationsFile }

// Puts the two weeks around the real date (FR-036): two working days already past, then today. Each
// meeting keeps its working-day position and local time. Only meetings that have ended keep a
// transcript, and only those keep their action items: nothing is recorded before it happens.
export function rebaseFiles(files: Files, now: Date, times: Record<string, TimeOverride> = {}): Files {
  const tz = files.calendar.timeZone
  const from = workingDays(files.annotations.window.start, files.annotations.window.end)
  let start = localDate(now, tz)
  for (let past = 0; past < 2; ) {
    start = addDays(start, -1)
    if (!weekend(start)) past++
  }
  const days: string[] = []
  for (let d = start; days.length < from.length; d = addDays(d, 1)) if (!weekend(d)) days.push(d)

  const items = files.calendar.items.map((ev) => {
    if (!ev.start.dateTime || !ev.end.dateTime) return ev
    const s = new Date(ev.start.dateTime)
    const e = new Date(ev.end.dateTime)
    const t = times[ev.id] ?? { day: from.indexOf(localDate(s, tz)), start: localMinutes(s, tz), end: localMinutes(s, tz) + (+e - +s) / 60e3 }
    return { ...ev, start: { dateTime: zoned(days[t.day], t.start, tz).toISOString() }, end: { dateTime: zoned(days[t.day], t.end, tz).toISOString() } }
  })
  const ended = new Set(items.filter((ev) => ev.end.dateTime && +new Date(ev.end.dateTime) <= +now).map((ev) => ev.id))
  return {
    calendar: { ...files.calendar, items },
    transcripts: Object.fromEntries(Object.entries(files.transcripts).filter(([id]) => ended.has(id))),
    annotations: {
      ...files.annotations,
      window: { start: days[0], end: days[days.length - 1] },
      actionItems: files.annotations.actionItems.filter((a) => ended.has(a.meetingId)),
    },
  }
}

// Browser entry: the bundled synthetic set. Swapping in real exports means replacing these files.
export async function loadFiles() {
  const calendar = (await import('../../data/calendar.json')).default as CalendarFile
  const annotations = (await import('../../data/annotations.json')).default as AnnotationsFile
  const files = import.meta.glob<{ default: TranscriptFile }>('../../data/transcripts/*.json', { eager: true })
  const transcripts: Record<string, TranscriptFile> = {}
  for (const f of Object.values(files)) transcripts[f.default.eventId] = f.default
  return { calendar, transcripts, annotations }
}
