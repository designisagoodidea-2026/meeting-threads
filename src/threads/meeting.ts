import type { ActionItem, AgendaItem, Meeting, Model, Suggestion, Turn } from '../data/types'
import { gapFor } from './explain'

export type MeetingSummary = {
  meeting: Meeting
  attendees: string[] // lead first, then others by name
  agenda: { seeded: AgendaItem[]; accepted: Suggestion[]; pending: Suggestion[] }
  transcript: { turn: Turn; themeIds: string[] }[] | null
  gap: 'hidden' | 'not-recorded' | 'upcoming' | null
  themes: { themeId: string; prevMeetingId: string | null; nextMeetingId: string | null }[]
  actionItems: { item: ActionItem; status: 'open' | 'on-agenda' }[]
}

// Everything known about one meeting, for its page (spec 006 data-model.md). Reads the privacy-applied
// model, so a hidden meeting arrives without its transcript or action items.
export function meetingSummary(model: Model, meetingId: string, suggestions: Suggestion[], doneItems: Set<string>): MeetingSummary {
  const meeting = model.meetingById.get(meetingId)
  if (!meeting) throw new Error(`meetingSummary: unknown meeting ${meetingId}`)
  const name = (id: string) => model.people.get(id)?.name ?? id
  const others = meeting.attendeeIds.filter((id) => id !== model.leadId).sort((a, b) => name(a).localeCompare(name(b)))
  const here = suggestions.filter((s) => s.targetMeetingId === meetingId)
  const gap = gapFor(meeting)
  return {
    meeting,
    attendees: meeting.attendeeIds.includes(model.leadId) ? [model.leadId, ...others] : others,
    agenda: { seeded: meeting.agenda, accepted: here.filter((s) => s.status === 'accepted'), pending: here.filter((s) => s.status === 'pending') },
    transcript: meeting.transcript
      ? meeting.transcript.map((turn) => ({ turn, themeIds: model.themes.filter((t) => t.turnIds.includes(turn.id)).map((t) => t.id) }))
      : null,
    gap: gap === 'no-mention' ? null : gap,
    themes: meeting.themeIds.map((themeId) => {
      const ids = model.themes.find((t) => t.id === themeId)!.meetingIds
      const i = ids.indexOf(meetingId)
      return { themeId, prevMeetingId: ids[i - 1] ?? null, nextMeetingId: ids[i + 1] ?? null }
    }),
    actionItems: model.actionItems
      .filter((a) => a.meetingId === meetingId)
      .map((item) => ({ item, status: doneItems.has(item.id) ? 'on-agenda' : 'open' })),
  }
}
