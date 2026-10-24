import type { Meeting, Model, Turn } from '../data/types'

export type OpenThread = { kind: 'action' | 'theme'; id: string; label: string; nextMeetingId: string | null }
export type PersonSummary = { meetings: { meeting: Meeting; turns: Turn[] }[]; open: OpenThread[] }

// What the person page shows (FR-027, FR-028): shared meetings with what this person and the lead said,
// and the open threads involving them with the next meeting each is headed for.
export function personSummary(model: Model, personId: string, doneItems: Set<string> = new Set()): PersonSummary {
  const theirs = model.meetings.filter((m) => m.attendeeIds.includes(personId))
  const after = (start: Date, ok: (m: Meeting) => boolean) => theirs.find((m) => +m.start > +start && ok(m))?.id ?? null

  const meetings = theirs.map((meeting) => ({
    meeting,
    turns: (meeting.transcript ?? []).filter((t) => t.speakerId === personId || t.speakerId === model.leadId),
  }))

  const open: OpenThread[] = []
  for (const a of model.actionItems) {
    if (a.ownerId !== personId || a.status !== 'open' || doneItems.has(a.id)) continue
    open.push({ kind: 'action', id: a.id, label: a.text, nextMeetingId: after(model.meetingById.get(a.meetingId)!.start, () => true) })
  }
  for (const t of model.themes) {
    const spoke = theirs.filter((m) => m.transcript?.some((tu) => tu.speakerId === personId && t.turnIds.includes(tu.id)))
    if (!spoke.length) continue
    open.push({ kind: 'theme', id: t.id, label: t.name, nextMeetingId: after(spoke[spoke.length - 1].start, (m) => m.themeIds.includes(t.id)) })
  }
  return { meetings, open }
}
