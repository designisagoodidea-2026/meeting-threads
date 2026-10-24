import type { Model, Suggestion, Turn } from '../data/types'
import { pickTarget, type Basis } from './suggestions'

export type Why = { quotes: { meetingId: string; turn: Turn }[]; reason: string }

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// Why a suggestion exists and why it points where it does (spec 006 FR-027), stated from the same
// pickTarget ranking that chose the target (spec 005 research R5, revised), so the two can't disagree.
export function whySuggested(model: Model, s: Suggestion): Why {
  const quotes = s.sources.map(({ meetingId, turnId }) => {
    const turn = model.meetingById.get(meetingId)?.transcript?.find((t) => t.id === turnId)
    if (!turn) throw new Error(`whySuggested: source turn ${turnId} not found`)
    return { meetingId, turn }
  })
  const first = (id: string) => (id === model.leadId ? 'You' : (model.people.get(id)?.name.split(' ')[0] ?? id))
  const title = (id: string) => model.meetingById.get(id)!.title
  const topic = s.id.slice(s.id.indexOf(':') + 1)
  const theme = model.themes.find((t) => t.id === topic)
  const src = quotes[0].meetingId

  // Who the topic travels with, and which theme decides where it can land.
  let opener: string
  let people: string[]
  let themeId: string | null
  if (!theme) {
    const items = quotes.map((q) => model.actionItems.find((a) => a.sourceTurnId === q.turn.id && a.topicKey === topic)!)
    opener = items.map((a, i) => `${i ? first(a.ownerId) : `${first(a.ownerId)} took this on`} in ${title(a.meetingId)}`).join(', and ') + '.'
    people = [...new Set(items.map((a) => a.ownerId))]
    themeId = items[0].themeId
  } else {
    const excluded = model.excludedPersonIds ?? new Set<string>()
    people = [
      ...new Set(
        quotes.flatMap((q) =>
          (model.meetingById.get(q.meetingId)!.transcript ?? [])
            .filter((t) => theme.turnIds.includes(t.id) && t.speakerId && t.speakerId !== model.leadId && !excluded.has(t.speakerId))
            .map((t) => t.speakerId!),
        ),
      ),
    ]
    opener = `${list(people.map(first))} raised ${theme.name} in ${list([...new Set(quotes.map((q) => title(q.meetingId)))])}.`
    themeId = theme.id
  }

  const pick = pickTarget(model, src, people, themeId)
  const themeName = model.themes.find((t) => t.id === themeId)?.name ?? 'its theme'
  // Everyone the topic travels with who will be in the target, not just the first one found.
  const present = s.targetMeetingId ? people.filter((p) => p !== model.leadId && model.meetingById.get(s.targetMeetingId!)!.attendeeIds.includes(p)) : []
  const who = present.length ? list(present.map(first)) : null
  const are = present.length > 1 ? 'are' : 'is'
  const lead = people.every((p) => p === model.leadId)
  const target = s.targetMeetingId ? title(s.targetMeetingId) : null
  const because: Record<Basis, string> = {
    theme: `${target} is the next meeting where ${themeName} is on the table${who ? `, and ${who} ${are} in it` : ''}.`,
    series: `${target} is the next session of the same meeting${who ? `, and ${who} will be there` : ''}.`,
    'one-on-one': `${target} is your next 1:1 with ${pick.person ? first(pick.person) : who}, and nothing sooner has ${themeName} on the table.`,
  }
  const none = lead
    ? `No later meeting puts ${themeName} on the table, and ${title(src)} doesn't meet again. Worth calling a short meeting for it.`
    : `No later meeting puts ${themeName} on the table with ${list(people.map(first))} in it, ${title(src)} doesn't meet again with them, and there's no 1:1 coming up. Worth calling a short meeting for it.`
  return { quotes, reason: `${opener} ${s.basis && target ? because[s.basis] : none}` }
}
