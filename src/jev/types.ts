// Jev commitment confirmation (spec 007 data-model.md). Nothing here holds the key.

// A turn the widened rules propose as a possible commitment (research R4).
export type Candidate = {
  turnId: string // `<meetingId>#<segmentId>`, as elsewhere
  speakerId: string | null // null when the speaker isn't on the invite
  cue: string // the phrase that triggered it, e.g. `I'll`, `I'm …ing`
}

// A sensitive value found in a transcript and what replaces it everywhere (research R7).
export type RedactionKind = 'ssn' | 'dob' | 'card' | 'account'
export type Redaction = {
  kind: RedactionKind
  value: string // the exact text found; never saved, never sent to Jev
  forms: string[] // every spelling replaced (e.g. "July 14", "July 14th")
  placeholder: string
  turnIds: string[] // every turn where it was replaced
}

export type OwnerAnswer = { choice: string; confidence: number }
export type UnavailableReason = 'off' | 'no-key' | 'key-refused' | 'redaction-blocked' | `error ${number}` | 'not-on-this-build'

// What Jev returned for one candidate, or why it didn't. `commitment` is null only when `status` isn't `ok`.
export type JevAnswer = {
  turnId: string
  questionSet: string // `mt-turn-1`
  model: string // as reported by Jev, e.g. `jev-1.13.0`
  sentHash: string // hash of the redacted state that was sent (research R8)
  commitment: number | null
  ownerA: OwnerAnswer | null
  ownerB: OwnerAnswer | null
  status: 'ok' | 'unavailable'
  reason: UnavailableReason | null
}

// One per listed candidate, what the preview shows. Rules-only mode has no `set-aside`.
export type ImportDecision = {
  turnId: string
  outcome: 'commitment' | 'needs-a-look' | 'set-aside'
  decidedBy: 'jev' | 'rules' | 'bundle' // `bundle` = the answer arrived with an Atlas bundle
  rating: number | null // shown only when `decidedBy` isn't `rules`
  ownerId: string | null // attendee id, or the speaker when Jev's owner isn't agreed; null for an unknown speaker
  ownerUnsure: boolean
  selected: boolean // for `needs-a-look`: whether the lead ticked it
}
