import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { proposeCandidates } from '../src/jev/candidates'
import type { TranscriptFile } from '../src/data/types'

// Spec 007 FR-001 and research R4: the rules now only propose; Jev decides.
const tr = (...lines: [string, string][]): TranscriptFile => {
  const names = [...new Set(lines.map(([s]) => s))]
  return {
    eventId: 'm',
    speakers: names.map((name, i) => ({ label: `S${i}`, name })),
    segments: lines.map(([s, text], i) => ({ id: i, speaker: `S${names.indexOf(s)}`, startMs: i * 1000, text })),
  }
}
const ids = (t: TranscriptFile, map: Record<string, string> = {}) => proposeCandidates(t, map).map((c) => c.turnId)

describe('proposeCandidates', () => {
  it('proposes forward first-person forms the old rules missed', () => {
    const t = tr(
      ['Priya', "Okay. Hold on, I'll be, give me a minute. I'll be sending you the signed scope doc."],
      ['Maya', "Real quick on the modal: the badge is at 3.8:1, so I'm bumping it to slate-900."],
      ['Riley', "We'll lock the CORS allowlist by Thursday."],
      ['Sam', "I'm going to file the change ticket."],
    )
    expect(ids(t)).toEqual(['m#0', 'm#1', 'm#2', 'm#3'])
  })

  it('still proposes hedges and questions, for Jev to judge', () => {
    expect(ids(tr(['A', "I'll be honest, this is fine."], ['B', 'I can send it tonight, okay?'], ['C', 'Let me know when you can.']))).toEqual(['m#0', 'm#1', 'm#2'])
  })

  it('skips turns with no forward cue', () => {
    expect(ids(tr(['A', 'The repository is a mess.'], ['B', 'Sounds good, thanks.']))).toEqual([])
  })

  it('records the speaker (null when not on the invite) and the cue', () => {
    const [c] = proposeCandidates(tr(['Dev Patel', "I'll pull the notes."]), { S0: 'dev@x' })
    expect(c).toEqual({ turnId: 'm#0', speakerId: 'dev@x', cue: "I'll" })
    expect(proposeCandidates(tr(['Stranger', "I'll pull the notes."]), {})[0].speakerId).toBeNull()
  })

  // Every labelled commitment in the committed sets must reach Jev (SC-002 needs ≥ 95% across all sets).
  for (const name of ['atlas-scripted', 'mt-holdout']) {
    it(`proposes every labelled commitment in ${name}`, () => {
      const set = JSON.parse(readFileSync(new URL(`../eval/jev/sets/${name}.json`, import.meta.url), 'utf8'))
      const found = new Set<string>()
      for (const m of set.meetings) {
        const t = tr(...m.turns.map((x: { speaker: string; text: string }) => [x.speaker, x.text] as [string, string]))
        for (const id of ids(t)) found.add(m.turns[Number(id.split('#')[1])].id)
      }
      expect(set.commitments.filter((c: string) => !found.has(c))).toEqual([])
    })
  }
})
