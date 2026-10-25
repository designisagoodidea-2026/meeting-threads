import type { TranscriptFile } from '../data/types'
import type { Candidate } from './types'

// The first pass (spec 007 FR-001, research R4): propose any turn with a first-person forward cue.
// It is deliberately wide, with no hedge or question filters, because Jev decides which are real.
const CUES: [label: string, pattern: RegExp][] = [
  ["I'll", /\bI['’]ll\b/i],
  ['I will', /\bI will\b/i],
  ["I'm going to", /\bI['’]m (?:going to|gonna)\b/i],
  ['let me', /\blet me\b/i],
  ['I can', /\bI can\b/i],
  ["we'll", /\bwe['’]ll\b|\bwe will\b/i],
  ["I'm …ing", /\bI['’]m \w+ing (?:it|that|this|them|the|a|an|our|my|your|up|out|on)\b/i],
]

export function proposeCandidates(tr: TranscriptFile, speakerMap: Record<string, string>): Candidate[] {
  const out: Candidate[] = []
  for (const seg of tr.segments) {
    const hit = CUES.find(([, re]) => re.test(seg.text))
    if (hit) out.push({ turnId: `${tr.eventId}#${seg.id}`, speakerId: speakerMap[seg.speaker] ?? null, cue: hit[0] })
  }
  return out
}
