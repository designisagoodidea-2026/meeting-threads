import type { Meeting, Model, Suggestion, Turn } from '../data/types'
import type { Persisted } from '../store'

export type Basis = 'theme' | 'series' | 'one-on-one'

// A theme is a real topic of a meeting, not a passing remark: it's in the title or agenda, at least two
// turns discuss it on record, or the meeting wasn't recorded and the calendar's tag is all we have.
export function isTopicOf(model: Model, m: Meeting, themeId: string): boolean {
  if (!m.themeIds.includes(themeId)) return false
  const theme = model.themes.find((t) => t.id === themeId)!
  const name = theme.name.toLowerCase()
  if (m.title.toLowerCase().includes(name) || m.agenda.some((a) => a.text.toLowerCase().includes(name))) return true
  if (!m.transcript) return true
  return m.transcript.filter((t) => theme.turnIds.includes(t.id)).length >= 2
}

// Where a topic should land, and why (research R5, revised after review): a later meeting only gets a
// topic when there is a strong reason for it to hear it. In order:
//  1. 'theme'      the next meeting where the theme is a real topic (isTopicOf) and one of the people attends;
//  2. 'series'     the next session of the same recurring meeting, with one of them in it;
//  3. 'one-on-one' the lead's next 1:1 with one of them.
// Anything else gets no target: it needs its own meeting. Shared by the suggestions and their reasons.
export function pickTarget(model: Model, fromMeetingId: string, people: string[], themeId: string | null) {
  const from = model.meetingById.get(fromMeetingId)!
  // Only meetings still ahead: an agenda that already happened can't take anything (FR-036).
  const later = model.meetings.filter((m) => +m.start > +from.start && (!model.now || +m.start > +model.now))
  const with_ = (m: Meeting) => people.find((p) => m.attendeeIds.includes(p)) ?? null
  const pick = (basis: Basis, m: Meeting | undefined, person = m ? with_(m) : null) => (m ? { target: m, basis, person } : null)
  return (
    (themeId ? pick('theme', later.find((m) => isTopicOf(model, m, themeId) && with_(m))) : null) ??
    pick('series', later.find((m) => m.title === from.title && m.type === from.type && with_(m))) ??
    pick('one-on-one', later.find((m) => m.type === 'one-on-one' && people.some((p) => p !== model.leadId && m.attendeeIds.includes(p)))) ?? {
      target: null,
      basis: null,
      person: null,
    }
  )
}

// A theme follow-up's agenda line (FR-042): the theme, who raised it and their words, so the line says
// what to pick up rather than only naming the theme. Long quotes are cut at a word, about 140 characters.
function followUpLine(model: Model, themeName: string, turn: Turn): string {
  const first = (model.people.get(turn.speakerId!)?.name ?? 'someone').split(' ')[0]
  const words = turn.text.length <= 140 ? turn.text : `${turn.text.slice(0, 140).replace(/\s+\S*$/, '')}…`
  return `${themeName}, from ${first}: “${words}”`
}

// Suggested agenda items. Derived every time from the model plus the lead's stored decisions, never
// stored themselves, so accept, dismiss and privacy changes can't drift out of sync.
//  - An open action item goes where pickTarget sends its owner and its theme.
//  - A theme raised in a meeting, with no action item from that meeting already covering it, goes where
//    pickTarget sends the people (other than the lead) who spoke about it.
// Suggestions with the same target and topic merge into one with every source.
export function deriveSuggestions(model: Model, decisions: Persisted['decisions']): Suggestion[] {
  const byId = new Map<string, Suggestion & { latest: number }>()
  const add = (topicKey: string, text: string, meetingId: string, turnId: string, target: Meeting | null, basis: Basis | null) => {
    const id = `${target?.id ?? 'none'}:${topicKey}`
    const start = +model.meetingById.get(meetingId)!.start
    const s = byId.get(id)
    if (s) {
      s.sources.push({ meetingId, turnId })
      s.latest = Math.max(s.latest, start)
      return
    }
    byId.set(id, {
      id, text, sources: [{ meetingId, turnId }], targetMeetingId: target?.id ?? null,
      visibleTo: target ? target.attendeeIds.filter((p) => p !== model.leadId) : [], status: 'pending', basis, latest: start,
    })
  }

  const excluded = model.excludedPersonIds ?? new Set<string>()
  const speakerOf = (turnId: string) =>
    model.meetingById.get(turnId.slice(0, turnId.lastIndexOf('#')))?.transcript?.find((t) => t.id === turnId)?.speakerId ?? null
  for (const a of model.actionItems) {
    if (a.status !== 'open') continue
    if (excluded.has(speakerOf(a.sourceTurnId) ?? '')) continue
    const { target, basis } = pickTarget(model, a.meetingId, [a.ownerId], a.themeId)
    add(a.topicKey, a.text, a.meetingId, a.sourceTurnId, target, basis)
  }
  for (const theme of model.themes) {
    for (const meetingId of theme.meetingIds) {
      if (model.actionItems.some((a) => a.meetingId === meetingId && a.themeId === theme.id)) continue
      const meeting = model.meetingById.get(meetingId)!
      const turns = (meeting.transcript ?? []).filter((t) => theme.turnIds.includes(t.id))
      const speakers = new Set(turns.map((t) => t.speakerId).filter((p): p is string => !!p && p !== model.leadId && !excluded.has(p)))
      if (!speakers.size) continue // nobody but the lead said anything about it on record
      const raisers = [...new Set(turns.map((t) => t.speakerId!).filter((p) => speakers.has(p)))]
      const { target, basis } = pickTarget(model, meetingId, raisers, theme.id)
      // Quote the person who links this meeting to the target, so the evidence matches the reason.
      const bridge = turns.find((t) => speakers.has(t.speakerId!) && (!target || target.attendeeIds.includes(t.speakerId!)))
      const said = bridge ?? turns.find((t) => speakers.has(t.speakerId!))!
      add(theme.id, followUpLine(model, theme.name, said), meetingId, said.id, target, basis)
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.latest - a.latest)
    .map(({ latest: _, ...s }) => {
      const d = decisions[s.id]
      return d ? { ...s, status: d.status, text: d.text ?? s.text } : s
    })
}
