import qs from '../../scripts/jev/questions.json'
import type { Candidate, ImportDecision, JevAnswer } from './types'

// Spec 007 FR-002 to FR-005: thresholds come from the shared question set, never from code.
const { yes: YES, no: NO, owner_min_confidence: OWNER_MIN } = qs.thresholds

type Attendee = { id: string; name: string }

// The owner Jev named, only when both attendee orders agree with enough confidence (research R6).
// Otherwise the speaker, marked unsure.
export function ownerFor(answer: JevAnswer, attendees: Attendee[], speakerId: string | null): { ownerId: string | null; ownerUnsure: boolean } {
  const { ownerA: a, ownerB: b } = answer
  const agreed = a && b && a.choice === b.choice && a.confidence >= OWNER_MIN && b.confidence >= OWNER_MIN
  const match = agreed ? attendees.find((p) => p.name === a.choice || p.name.split(' ')[0] === a.choice) : undefined
  return match ? { ownerId: match.id, ownerUnsure: false } : { ownerId: speakerId, ownerUnsure: true }
}

// What the preview shows for one candidate. Null when Jev didn't answer and the plain rules don't call it a commitment.
export function decide(args: { candidate: Candidate; answer: JevAnswer | null; rulesSay: boolean; attendees: Attendee[]; fromBundle?: boolean }): ImportDecision | null {
  const { candidate: c, answer, rulesSay, attendees, fromBundle } = args
  const base = { turnId: c.turnId, selected: false }
  if (!answer || answer.status !== 'ok' || answer.commitment === null) {
    return rulesSay ? { ...base, outcome: 'commitment', decidedBy: 'rules', rating: null, ownerId: c.speakerId, ownerUnsure: false } : null
  }
  const r = answer.commitment
  const outcome = r >= YES ? 'commitment' : r <= NO ? 'set-aside' : 'needs-a-look'
  return { ...base, outcome, decidedBy: fromBundle ? 'bundle' : 'jev', rating: r, ...ownerFor(answer, attendees, c.speakerId) }
}

// Research R8: a saved answer is reused only for the same question set, model and sent text.
export function reusable(answer: JevAnswer, sent: { questionSet: string; model: string; sentHash: string }): 'reuse' | 'version-mismatch' | 'stale' {
  if (answer.status !== 'ok') return 'stale'
  if (answer.questionSet !== sent.questionSet || answer.model !== sent.model) return 'version-mismatch'
  return answer.sentHash === sent.sentHash ? 'reuse' : 'stale'
}
