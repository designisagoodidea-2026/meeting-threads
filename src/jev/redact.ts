import type { Redaction, RedactionKind } from './types'

// Sensitive values are found across the whole transcript first, then every copy is replaced in every
// turn, so a value one speaker says and the other repeats back is caught both times (spec 007 R7).
// Over-redaction is the safe side: a 4-digit SSN tail is replaced wherever it appears.

type Turn = { id: string; text: string }

export const PLACEHOLDER: Record<RedactionKind, string> = {
  ssn: '[SSN digits]',
  dob: '[date of birth]',
  card: '[card number]',
  account: '[account number]',
}

const SSN_FULL = /\b\d{3}-\d{2}-\d{4}\b/g
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g
const ACCOUNT = /\b\d{8,17}\b/g
const SSN_CONTEXT = /\b(?:social(?: security)?|ssn|last (?:4|four))\b/i
const DOB_CONTEXT = /\b(?:date of birth|dob|birthday|birth date|born on)\b/i
const ACCOUNT_CONTEXT = /\b(?:account|routing|iban)\b/i
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_DAY = new RegExp(`\\b(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')
const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/

const digits = (s: string) => s.replace(/\D/g, '')
function luhn(num: string): boolean {
  let sum = 0
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i])
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return num.length >= 13 && sum % 10 === 0
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The pattern that finds every spelling of a registered value.
function matcher(r: Pick<Redaction, 'kind' | 'value'>): RegExp {
  if (r.kind === 'dob') {
    const m = r.value.match(MONTH_DAY)
    if (m) {
      const month = MONTHS.find((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)))!
      return new RegExp(`\\b(?:${month}|${month.slice(0, 3)})\\.?\\s+${Number(m[2])}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, 'gi')
    }
    return new RegExp(escape(r.value), 'g')
  }
  // Digit values match with or without spaces and dashes between digits.
  return new RegExp(`\\b${digits(r.value).split('').join('[ -]?')}\\b`, 'g')
}

export function buildRegistry(turns: Turn[]): Redaction[] {
  const found: Redaction[] = []
  const add = (kind: RedactionKind, value: string) => {
    if (!found.some((r) => r.kind === kind && digits(r.value) + r.value === digits(value) + value))
      found.push({ kind, value, forms: [], placeholder: PLACEHOLDER[kind], turnIds: [] })
  }
  turns.forEach((turn, i) => {
    for (const m of turn.text.matchAll(SSN_FULL)) add('ssn', m[0])
    for (const m of turn.text.matchAll(CARD)) if (luhn(digits(m[0]))) add('card', m[0])
    if (ACCOUNT_CONTEXT.test(turn.text))
      for (const m of turn.text.matchAll(ACCOUNT)) if (!luhn(m[0])) add('account', m[0])
    const window = turns.slice(i, i + 3)
    const ssnCue = turn.text.match(SSN_CONTEXT)
    if (ssnCue) {
      // the tail is said after the question: later in this turn, or in the next two
      const texts = [turn.text.slice(ssnCue.index! + ssnCue[0].length), ...window.slice(1).map((w) => w.text)]
      for (const text of texts) {
        const m = text.replace(SSN_FULL, '').match(/\b\d{4}\b/)
        if (m) { add('ssn', m[0]); break }
      }
    }
    if (DOB_CONTEXT.test(turn.text))
      for (const w of window) {
        const m = w.text.match(MONTH_DAY) ?? w.text.match(NUMERIC_DATE)
        if (m) { add('dob', m[0]); break }
      }
  })
  return found
}

export function applyRedactions(turns: Turn[], registry: Redaction[]): { turns: Turn[]; registry: Redaction[] } {
  // Longest values first, so a card number is replaced before any 4-digit group inside it.
  const order = [...registry].sort((a, b) => digits(b.value).length - digits(a.value).length || b.value.length - a.value.length)
  const out = order.map((r) => ({ ...r, forms: [] as string[], turnIds: [] as string[] }))
  const redacted = turns.map((turn) => {
    let text = turn.text
    out.forEach((r) => {
      text = text.replace(matcher(r), (m) => {
        if (!r.forms.includes(m)) r.forms.push(m)
        if (!r.turnIds.includes(turn.id)) r.turnIds.push(turn.id)
        return r.placeholder
      })
    })
    return { ...turn, text }
  })
  return { turns: redacted, registry: out }
}

export type ScanHit = { kind: RedactionKind | 'registry'; index: number }

// The last check before anything leaves: formats that are always sensitive, plus every value already
// found in this transcript. Any hit means nothing is sent (FR-008).
export function finalScan(texts: string[], forms: string[]): ScanHit[] {
  const hits: ScanHit[] = []
  texts.forEach((text, index) => {
    if (new RegExp(SSN_FULL.source).test(text)) hits.push({ kind: 'ssn', index })
    if ([...text.matchAll(CARD)].some((m) => luhn(digits(m[0])))) hits.push({ kind: 'card', index })
    if (forms.some((f) => f && text.toLowerCase().includes(f.toLowerCase()))) hits.push({ kind: 'registry', index })
  })
  return hits
}
