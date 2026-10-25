import { describe, expect, it } from 'vitest'
import { applyRedactions, buildRegistry, finalScan } from '../src/jev/redact'

// Spec 007 FR-007, FR-008 and research R7. All values here are invented.
const t = (...texts: string[]) => texts.map((text, i) => ({ id: `m#${i}`, text }))
const redact = (turns: { id: string; text: string }[]) => applyRedactions(turns, buildRegistry(turns))

describe('redaction', () => {
  it('replaces a full SSN anywhere', () => {
    const { turns } = redact(t('My number is 123-45-6789, okay?'))
    expect(turns[0].text).toBe('My number is [SSN digits], okay?')
  })

  it('finds SSN last four by context and replaces every later repeat', () => {
    const { turns, registry } = redact(t('Can I have the last 4 of social?', '4169.', 'Thanks, so 4169, right?', 'We closed 4169 tickets.'))
    expect(turns[1].text).toBe('[SSN digits].')
    expect(turns[2].text).toBe('Thanks, so [SSN digits], right?')
    expect(turns[3].text).toBe('We closed [SSN digits] tickets.') // over-redaction is the safe side
    expect(registry.find((r) => r.kind === 'ssn')!.turnIds).toEqual(['m#1', 'm#2', 'm#3'])
  })

  it('replaces a date of birth said by one speaker and repeated back by the other', () => {
    const { turns } = redact(t('And your date of birth, just month and date?', 'July 14.', 'July 14th.', 'Got it: July 14th, 1980.'))
    expect(turns.slice(1).map((x) => x.text)).toEqual(['[date of birth].', '[date of birth].', 'Got it: [date of birth].'])
    // context built from the redacted turns can't leak it either
    expect(turns.map((x) => x.text).join(' ')).not.toMatch(/July 14|1980/)
  })

  it('finds a numeric date of birth', () => {
    const { turns } = redact(t("What's your DOB?", 'It is 03/29/1980.'))
    expect(turns[1].text).toBe('It is [date of birth].')
  })

  it('replaces a Luhn-valid card number but not a Luhn-invalid one', () => {
    const { turns } = redact(t('Card is 4242 4242 4242 4242 thanks', 'Ref 4242 4242 4242 4241'))
    expect(turns[0].text).toBe('Card is [card number] thanks')
    expect(turns[1].text).toBe('Ref 4242 4242 4242 4241')
  })

  it('replaces an account number only near account words', () => {
    const { turns } = redact(t('My account number is 12345678901.', 'We shipped 12345678 units.'))
    expect(turns[0].text).toBe('My account number is [account number].')
    expect(turns[1].text).toBe('We shipped 12345678 units.')
  })

  it('finds nothing in a clean transcript', () => {
    expect(buildRegistry(t("I'll send the scope doc in ten minutes.", 'Great, thanks.'))).toEqual([])
  })

  it('finalScan catches a seeded leak, a format match, and passes clean text', () => {
    expect(finalScan(['all good here'], [])).toEqual([])
    expect(finalScan(['her birthday is July 14'], ['July 14']).length).toBeGreaterThan(0)
    expect(finalScan(['ssn 123-45-6789'], []).map((h) => h.kind)).toEqual(['ssn'])
    expect(finalScan(['pay with 4242424242424242'], []).map((h) => h.kind)).toEqual(['card'])
  })
})

describe('sensitive-sample.txt (spec 007 T023)', () => {
  it('leaves none of the three values in any turn the Jev path would send', async () => {
    const { readFileSync } = await import('node:fs')
    const { parseTranscript } = await import('../src/data/extract')
    const tr = parseTranscript(readFileSync(new URL('../eval/jev/sets/sensitive-sample.txt', import.meta.url), 'utf8'), 'e')
    const raw = tr.segments.map((g) => ({ id: `e#${g.id}`, text: g.text }))
    const { turns, registry } = applyRedactions(raw, buildRegistry(raw))
    const all = turns.map((x) => x.text).join('\n')
    expect(all).not.toMatch(/7731|September 3|1988|4242/)
    expect(registry.map((r) => r.kind).sort()).toEqual(['card', 'dob', 'ssn'])
    expect(finalScan(turns.map((x) => x.text), registry.flatMap((r) => r.forms))).toEqual([])
  })
})
