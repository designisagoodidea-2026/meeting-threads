import type { Persisted } from '../store'
import type { Model } from './types'

// Runs before every derived view (contracts/ui-state.md). Returns a new model; the loaded one is untouched,
// so reversing a setting restores exactly what was there, and stored decisions line up again.
//  - A hidden meeting keeps its place on the calendar but loses its transcript, so its quotes, beads
//    (action items) and suggestions disappear everywhere (FR-036).
//  - Excluded people stay visible; suggestions just stop drawing on what they said (FR-037).
export function applyPrivacy(model: Model, privacy: Persisted['privacy']): Model {
  const hidden = new Set(privacy.hiddenMeetingIds)
  const meetings = model.meetings.map((m) => (hidden.has(m.id) ? { ...m, transcript: null, transcriptHidden: true } : m))
  return {
    ...model,
    meetings,
    meetingById: new Map(meetings.map((m) => [m.id, m])),
    themes: model.themes.map((t) => ({ ...t, turnIds: t.turnIds.filter((id) => !hidden.has(id.slice(0, id.lastIndexOf('#')))) })),
    actionItems: model.actionItems.filter((a) => !hidden.has(a.meetingId)),
    excludedPersonIds: new Set(privacy.excludedPersonIds),
  }
}
