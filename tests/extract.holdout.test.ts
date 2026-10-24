// Was the loop's holdout (spec 006 FR-032): a messy Otter-style export, with hedge traps and an
// off-invite speaker. Its first run failed on an item's theme; kept as a regression test.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyImport, extractAnnotations, parseTranscript } from '../src/data/extract'
import { buildModel } from '../src/data/load'
import { model, rawData } from './fixtures'

const text = readFileSync(new URL('./fixtures-otter-sam-dev.txt', import.meta.url), 'utf8')
const MEETING = 'evt_20261105_1100'

describe('holdout: a messy Otter-style export', () => {
  const m = model()
  const tr = parseTranscript(text, MEETING)
  const out = extractAnnotations(m, MEETING, tr)
  const textOf = (id: string) => tr.segments.find((s) => `${MEETING}#${s.id}` === id)!.text

  it('parses every turn and maps known speakers, leaving strangers unknown', () => {
    expect(tr.segments).toHaveLength(10)
    expect(out.speakerMap[tr.speakers.find((s) => s.name === 'Sam Rivera')!.label]).toBe('sam@northwind.example')
    expect(out.speakerMap[tr.speakers.find((s) => s.name === 'Dev Patel')!.label]).toBe('dev@northwind.example')
    expect(out.speakerMap[tr.speakers.find((s) => s.name === 'Speaker 3')!.label]).toBeUndefined()
  })

  it('finds exactly the two commitments, with owner and theme', () => {
    expect(out.actionItems.map((a) => [a.ownerId, a.themeId])).toEqual([
      ['dev@northwind.example', 'research-ops'],
      ['sam@northwind.example', 'research-ops'],
    ])
    expect(textOf(out.actionItems[0].sourceTurnId)).toMatch(/six months of study notes/)
    expect(textOf(out.actionItems[1].sourceTurnId)).toMatch(/ask Hannah/)
    expect(out.actionItems[0].text).toMatch(/^Pull the last six months of study notes/)
  })

  it('does not treat "I\'ll be honest" or "I\'ll be out" as commitments', () => {
    const src = new Set(out.actionItems.map((a) => textOf(a.sourceTurnId)))
    for (const t of src) expect(t).not.toMatch(/I'll be (honest|out)/)
  })

  it('tags the research turns with Evidence base and the meeting with it', () => {
    const tagged = (out.themeMentions['research-ops'] ?? []).map(textOf)
    expect(tagged.filter((t) => /repository|taxonomy|insights|study notes/.test(t)).length).toBeGreaterThanOrEqual(2)
    expect(out.themeIds).toContain('research-ops')
    expect(out.themeIds).not.toContain('hiring')
  })

  it('builds into a valid model with the transcript attached', () => {
    // the import goes through the same validation as the bundled files
    const f = applyImport(rawData(), { transcript: tr, ...out })
    const built = buildModel(f.calendar, f.transcripts, f.annotations)
    expect(built.meetingById.get(MEETING)!.transcript).toHaveLength(10)
    expect(built.actionItems.filter((a) => a.meetingId === MEETING)).toHaveLength(2)
  })
})
