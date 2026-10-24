// Model types per specs/005-meeting-threads/data-model.md, plus the input-file shapes
// from contracts/data-files.md.

export const DISCIPLINES = [
  'design',
  'research',
  'product',
  'eng-management',
  'design-leadership',
  'recruiting',
  'external',
] as const
export type Discipline = (typeof DISCIPLINES)[number]

export const MEETING_TYPES = [
  'one-on-one',
  'team-sync',
  'design-crit',
  'stakeholder-review',
  'interview',
  'external',
] as const
export type MeetingType = (typeof MEETING_TYPES)[number]

export type Person = {
  id: string // email
  name: string
  role: string
  discipline: Discipline
  isLead: boolean
}

export type Turn = {
  id: string // `${meetingId}#${segmentId}`
  meetingId: string
  speakerId: string | null // null = "Unknown speaker"
  offsetMs: number
  text: string
}

export type AgendaItem = { text: string; origin: 'seeded' | { suggestionId: string } }

export type Meeting = {
  id: string
  title: string
  start: Date
  end: Date
  type: MeetingType
  attendeeIds: string[]
  themeIds: string[]
  agenda: AgendaItem[]
  transcript: Turn[] | null
  transcriptHidden?: boolean // the lead hid it (FR-036); `transcript` is then null
}

export type Theme = {
  id: string
  name: string
  color: string
  meetingIds: string[] // sorted by meeting start
  turnIds: string[]
  projectIds: string[] // a theme can run through more than one project
}

// A project is a set of themes that run through it.
export type Project = { id: string; name: string; themeIds: string[] }

export type ActionItem = {
  id: string
  text: string
  ownerId: string
  meetingId: string
  sourceTurnId: string
  themeId: string | null
  topicKey: string
  status: 'open' | 'done'
}

export type Suggestion = {
  id: string // `${targetMeetingId}:${topicKey}`
  text: string
  sources: { meetingId: string; turnId: string }[]
  targetMeetingId: string | null
  visibleTo: string[]
  status: 'pending' | 'accepted' | 'dismissed'
  basis: 'theme' | 'series' | 'one-on-one' | null // why the target was chosen; null = needs its own meeting
}

export type RelationshipNote = { id: string; personId: string; text: string; updatedAt: string }

export type Model = {
  timeZone: string // the calendar's zone; layout reads day and hour in it
  days: string[] // the working days in the window, as YYYY-MM-DD
  people: Map<string, Person>
  leadId: string
  meetings: Meeting[] // sorted by start
  meetingById: Map<string, Meeting>
  themes: Theme[]
  projects: Project[]
  actionItems: ActionItem[]
  excludedPersonIds?: Set<string> // left out of suggestions (FR-037), set by applyPrivacy
}

// ---- Input files ----

export type CalendarFile = {
  timeZone: string
  items: {
    id: string
    summary: string
    description?: string
    start: { dateTime?: string; date?: string }
    end: { dateTime?: string; date?: string }
    attendees?: { email: string; displayName?: string; self?: boolean }[]
  }[]
}

export type TranscriptFile = {
  eventId: string
  speakers: { label: string; name: string }[]
  segments: { id: number; speaker: string; startMs: number; text: string }[]
}

export type AnnotationsFile = {
  window: { start: string; end: string }
  people: { id: string; role: string; discipline: string; name?: string }[]
  speakerMap: Record<string, Record<string, string>>
  meetings: Record<string, { type: string; themeIds: string[] }>
  themes: { id: string; name: string; color: string; mentions: string[] }[]
  projects: { id: string; name: string; themeIds: string[] }[]
  actionItems: {
    id: string
    text: string
    ownerId: string
    meetingId: string
    sourceTurnId: string
    themeId: string | null
    topicKey: string
    status: string
  }[]
}
