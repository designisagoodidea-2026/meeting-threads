// ANCHOR (loop-ledger, spec 006 FR-032): the extractor, run on every bundled transcript, must
// reproduce the hand-made annotations it never sees. extractAnnotations learns only from the other
// meetings, so each meeting is a held-out case. Bars are fixed; do not edit them to pass.
import { describe, expect, it } from 'vitest'
import { extractAnnotations } from '../src/data/extract'
import { model, rawData } from './fixtures'

describe('anchor: extraction against the hand-made annotations', () => {
  const m = model()
  const { annotations, transcripts } = rawData()
  let tp = 0, fp = 0, fn = 0, owners = 0, tTp = 0, tFp = 0, tFn = 0, mtHit = 0, mtAll = 0, speakersOk = true
  for (const tr of Object.values(transcripts)) {
    const id = tr.eventId
    const out = extractAnnotations(m, id, tr)
    for (const [label, pid] of Object.entries(annotations.speakerMap[id] ?? {})) if (out.speakerMap[label] !== pid) speakersOk = false

    const want = new Map(annotations.actionItems.filter((a) => a.meetingId === id).map((a) => [a.sourceTurnId, a.ownerId]))
    const got = new Map(out.actionItems.map((a) => [a.sourceTurnId, a.ownerId]))
    for (const [turn, owner] of got) {
      if (want.has(turn)) { tp++; if (want.get(turn) === owner) owners++ } else fp++
    }
    for (const turn of want.keys()) if (!got.has(turn)) fn++

    for (const th of annotations.themes) {
      const w = new Set(th.mentions.filter((t) => t.startsWith(`${id}#`)))
      const g = new Set(out.themeMentions[th.id] ?? [])
      for (const t of g) (w.has(t) ? tTp++ : tFp++)
      for (const t of w) if (!g.has(t)) tFn++
    }
    const wantThemes = annotations.meetings[id].themeIds
    mtAll += wantThemes.length
    mtHit += wantThemes.filter((t) => out.themeIds.includes(t)).length
  }
  const f1 = (2 * tTp) / (2 * tTp + tFp + tFn)

  it('maps every diarized speaker to the right person', () => expect(speakersOk).toBe(true))
  it('finds action items: recall ≥ 0.9, precision ≥ 0.85, owner right ≥ 0.9', () => {
    expect(tp / (tp + fn)).toBeGreaterThanOrEqual(0.9)
    expect(tp / (tp + fp)).toBeGreaterThanOrEqual(0.85)
    expect(owners / tp).toBeGreaterThanOrEqual(0.9)
  })
  it(`tags theme mentions with F1 ≥ 0.6`, () => expect(f1).toBeGreaterThanOrEqual(0.6))
  it('recovers ≥ 0.8 of each meeting\'s annotated themes', () => expect(mtHit / mtAll).toBeGreaterThanOrEqual(0.8))
})
