import { describe, expect, it } from 'vitest'
import { applyImport, buildWithImports, extractAnnotations, parseTranscript } from '../src/data/extract'
import { buildModel } from '../src/data/load'
import { model, rawData } from './fixtures'

describe('parseTranscript', () => {
  it('reads "Name  m:ss" blocks (Otter), "[hh:mm:ss] Name: text" and "Name: text" lines', () => {
    const otter = parseTranscript('Sam Rivera  0:05\nHello there.\n\nDev Patel  1:02:03\nHi.\nSecond line.\n', 'e')
    expect(otter.segments.map((s) => [s.speaker, s.startMs, s.text])).toEqual([
      ['S1', 5000, 'Hello there.'],
      ['S2', 3723000, 'Hi. Second line.'],
    ])
    expect(otter.speakers).toEqual([{ label: 'S1', name: 'Sam Rivera' }, { label: 'S2', name: 'Dev Patel' }])
    const bracket = parseTranscript('[00:01:10] Sam Rivera: One.\n[00:01:20] Dev: Two.', 'e')
    expect(bracket.segments.map((s) => [s.startMs, s.text])).toEqual([[70000, 'One.'], [80000, 'Two.']])
    const plain = parseTranscript('Sam: One.\nDev: Two.\nSam: Three.', 'e')
    expect(plain.segments.map((s) => s.speaker)).toEqual(['S1', 'S2', 'S1'])
  })
  it('accepts the bundled JSON shape as-is, under the chosen meeting', () => {
    const tr = parseTranscript(JSON.stringify(Object.values(rawData().transcripts)[0]), 'mine')
    expect(tr.eventId).toBe('mine')
    expect(tr.segments.length).toBeGreaterThan(0)
  })
  it('rejects text with no speaker turns, saying what it expected', () => {
    expect(() => parseTranscript('just some notes\nwith no speakers', 'e')).toThrow(/speaker/i)
    expect(() => parseTranscript('', 'e')).toThrow()
  })
})

describe('extractAnnotations', () => {
  const m = model()
  const tr = parseTranscript("Sam Rivera: I'll be honest, this is fine.\nDev Patel: I'll take that: price out a standing participant panel.\nSomeone Else: Can I ask a question?", 'evt_20261112_1100')
  const out = extractAnnotations(m, 'evt_20261112_1100', tr)
  it('owns a commitment by its speaker, cleans its text, and skips hedges and questions', () => {
    expect(out.actionItems).toHaveLength(1)
    expect(out.actionItems[0]).toMatchObject({ ownerId: 'dev@northwind.example', text: 'Price out a standing participant panel', status: 'open' })
  })
  it('reuses the topic key of a matching item elsewhere, so suggestions can follow it', () => {
    expect(out.actionItems[0].topicKey).toBe(m.actionItems.find((a) => a.text === 'Price out a standing participant panel')!.topicKey)
  })
  it('leaves a speaker who is not on the invite unmapped', () => {
    expect(Object.values(out.speakerMap)).not.toContain(undefined)
    expect(out.speakerMap[tr.speakers.find((s) => s.name === 'Someone Else')!.label]).toBeUndefined()
  })
  it('gives an item a theme its meeting discusses when its words tie with another theme', () => {
    // "activation" names another theme; the research words tie with it. This 1:1 is about research.
    const t = parseTranscript("Dev Patel: I'll check activation numbers in the research repository.", 'evt_20261112_1100')
    const x = extractAnnotations(m, 'evt_20261112_1100', t)
    expect(x.themeMentions['onboarding']).toBeDefined() // the tie is real
    expect(x.actionItems[0].themeId).toBe('research-ops')
  })
  it('applies into files that build, replacing that meeting\'s earlier annotations', () => {
    const f = applyImport(rawData(), { transcript: tr, ...out })
    const built = buildModel(f.calendar, f.transcripts, f.annotations)
    expect(built.meetingById.get('evt_20261112_1100')!.transcript).toHaveLength(3)
    expect(built.actionItems.filter((a) => a.meetingId === 'evt_20261112_1100')).toHaveLength(1)
    // applying twice doesn't duplicate
    const g = applyImport(f, { transcript: tr, ...out })
    expect(buildModel(g.calendar, g.transcripts, g.annotations).actionItems.length).toBe(built.actionItems.length)
  })
})

// Review findings, iteration 6 (loop-ledger).
describe('parseTranscript, real-paste edge cases', () => {
  it('reads Otter headers with one space or a tab before the time', () => {
    const t = parseTranscript('Sam Rivera 0:05\nHello there.\n\nDev Patel\t1:10\nHi.', 'e')
    expect(t.speakers.map((s) => s.name)).toEqual(['Sam Rivera', 'Dev Patel'])
    expect(t.segments.map((s) => [s.startMs, s.text])).toEqual([[5000, 'Hello there.'], [70000, 'Hi.']])
  })
  it('does not mistake a sentence ending in a time for a header', () => {
    const t = parseTranscript('Sam Rivera 0:05\nLet us meet at 3:30\nthen decide.', 'e')
    expect(t.segments).toHaveLength(1)
    expect(t.segments[0].text).toBe('Let us meet at 3:30 then decide.')
  })
  it('keeps wrapped lines in "Name: text" format with the turn above', () => {
    const t = parseTranscript('Sam: One thing,\nand another.\nDev: Two.', 'e')
    expect(t.segments.map((s) => s.text)).toEqual(['One thing, and another.', 'Two.'])
  })
  it('inside an Otter block, a line starting with a time is text, not a new speaker', () => {
    const t = parseTranscript('Sam Rivera  0:05\n10:30 standup: moved to Friday.', 'e')
    expect(t.segments).toHaveLength(1)
    expect(t.speakers.map((s) => s.name)).toEqual(['Sam Rivera'])
  })
  it('rejects JSON with no turns or malformed turns', () => {
    expect(() => parseTranscript('{"segments":[],"speakers":[]}', 'e')).toThrow(/turn/i)
    expect(() => parseTranscript('{"speakers":[{"label":"S1","name":"A"}],"segments":[{"id":0,"speaker":"S9","startMs":0,"text":"x"}]}', 'e')).toThrow()
    expect(() => parseTranscript('{"speakers":[{"label":"S1","name":"A"}],"segments":[{"id":0,"speaker":"S1","startMs":0,"text":"x"},{"id":0,"speaker":"S1","startMs":1,"text":"y"}]}', 'e')).toThrow()
  })
})

describe('buildWithImports', () => {
  const m = model()
  const tr = parseTranscript("Dev Patel: I'll take that: price out a standing participant panel.", 'evt_20261112_1100')
  const good = { transcript: tr, ...extractAnnotations(m, 'evt_20261112_1100', tr) }
  it('applies good imports and skips, by name, one whose meeting no longer exists, without throwing', () => {
    const ghost = { ...good, transcript: { ...good.transcript, eventId: 'evt_gone' }, actionItems: [] }
    const { model: built, skipped } = buildWithImports(rawData(), { evt_20261112_1100: good, evt_gone: ghost })
    expect(skipped).toEqual(['evt_gone'])
    expect(built.meetingById.get('evt_20261112_1100')!.transcript).toHaveLength(1)
  })
})
