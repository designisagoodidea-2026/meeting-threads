import qs from '../../scripts/jev/questions.json'
import { proposeCandidates } from '../jev/candidates'
import { buildJevItems, leakedTurns, type JevItem } from '../jev/client'
import { decide, reusable } from '../jev/decide'
import { stateHash } from '../jev/proxy'
import type { ImportDecision, JevAnswer, UnavailableReason } from '../jev/types'
import { buildModel } from './load'
import type { AnnotationsFile, CalendarFile, Model, TranscriptFile } from './types'

// One pasted transcript into the same annotations the bundled data carries (spec 006 FR-032).
// Plain rules that run in the browser, so nothing is sent anywhere. They learn each theme's words from
// the other meetings' tagged turns. The rules miss commitments phrased without a cue ("I'm comfortable
// proposing…"); with Jev on, extractWithJev widens the net and lets Jev confirm (spec 007).

export type Extracted = {
  speakerMap: Record<string, string> // diarization label -> person id; unknown speakers left out
  themeMentions: Record<string, string[]> // theme id -> turn ids in this meeting
  themeIds: string[] // themes this meeting really discussed
  actionItems: AnnotationsFile['actionItems']
}
// spec 007 data-model.md; `mismatched`: bundle answers set aside as made with another version (FR-013)
export type JevImport = { used: boolean; answers: JevAnswer[]; decisions: ImportDecision[]; mismatched?: string[] }
export type Import = Extracted & { transcript: TranscriptFile; jev?: JevImport }
type Files = { calendar: CalendarFile; transcripts: Record<string, TranscriptFile>; annotations: AnnotationsFile }

const ms = (t: string) => t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0) * 1000

const NO_TURNS = 'No speaker turns found. Paste lines like "Name: what they said", or an Otter export ("Name  0:05" then the text).'
// A speaker header: up to four capitalized words (or "Speaker 3"), then a time, alone on the line.
const HEADER = /^([A-Z][\w.'-]*(?:\s[A-Z0-9][\w.'-]*){0,3})[ \t]+(\d{1,2}:\d{2}(?::\d{2})?)$/
const BRACKET = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]{1,40}):\s*(.+)$/
const PLAIN = /^([A-Z][^:]{0,39}):\s*(.+)$/

// Checks a pasted JSON transcript the way buildModel can't: real turns, known speakers, unique ids.
function checkJson(j: TranscriptFile) {
  const labels = new Set(j.speakers.map((s) => s?.label))
  const ids = new Set<number>()
  if (!j.segments.length) throw new Error(NO_TURNS)
  for (const g of j.segments) {
    if (typeof g?.id !== 'number' || ids.has(g.id)) throw new Error(`Turn ids must be unique numbers (found ${JSON.stringify(g?.id)}).`)
    if (!labels.has(g.speaker)) throw new Error(`Turn ${g.id} names speaker "${g.speaker}", who isn't in speakers.`)
    if (typeof g.startMs !== 'number' || typeof g.text !== 'string' || !g.text.trim()) throw new Error(`Turn ${g.id} needs a numeric startMs and some text.`)
    ids.add(g.id)
  }
}

// An Atlas meeting bundle (spec 007 contracts/atlas-bundle.md): people, then turns that may carry Jev's answers.
type BundleJev = { question_set?: string; model?: string; sent_hash?: string; status?: string; commitment?: number; owner_a?: JevAnswer['ownerA']; owner_b?: JevAnswer['ownerB'] }
type Bundle = { people: { person_id: string; name: string }[]; turns: { turn_id: string; person_id: string; start_ms?: number; text: string; jev?: BundleJev }[] }
const isBundle = (j: unknown): j is Bundle => !!j && typeof j === 'object' && Array.isArray((j as Bundle).turns) && Array.isArray((j as Bundle).people)

function fromBundle(b: Bundle, eventId: string): TranscriptFile {
  const known = new Set(b.people.map((p) => p.person_id))
  const tr: TranscriptFile = {
    eventId,
    speakers: b.people.map((p) => ({ label: p.person_id, name: p.name })),
    segments: b.turns.map((t, i) => ({ id: i, speaker: t.person_id, startMs: t.start_ms ?? 0, text: t.text })),
  }
  for (const g of tr.segments) if (!known.has(g.speaker)) throw new Error(`Turn ${g.id} names speaker "${g.speaker}", who isn't in people.`)
  if (!tr.segments.length) throw new Error(NO_TURNS)
  return tr
}

// The answers an Atlas bundle brings, by this meeting's turn ids (FR-012, FR-013). Only answers made with
// this question set and model are used; others are listed as `mismatched` and those turns count as unanswered.
// Null when the text isn't a bundle.
export function bundleAnswers(text: string, eventId: string): { answers: JevAnswer[]; mismatched: string[] } | null {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return null
  }
  if (!isBundle(j)) return null
  const answers: JevAnswer[] = []
  const mismatched: string[] = []
  j.turns.forEach((t, i) => {
    const a = t.jev
    const turnId = `${eventId}#${i}`
    if (!a || a.status === 'unavailable' || typeof a.commitment !== 'number') return
    if (a.question_set !== qs.question_set || a.model !== qs.model) return void mismatched.push(turnId)
    answers.push({ turnId, questionSet: a.question_set, model: a.model, sentHash: a.sent_hash ?? '', commitment: a.commitment, ownerA: a.owner_a ?? null, ownerB: a.owner_b ?? null, status: 'ok', reason: null })
  })
  return { answers, mismatched }
}

// Reads the bundled JSON shape, Otter-style "Name  m:ss" blocks, "[hh:mm:ss] Name: text" or "Name: text"
// lines. Inside an Otter block only a new header starts a turn; elsewhere unmatched lines wrap onto the last turn.
export function parseTranscript(text: string, eventId: string): TranscriptFile {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    // not JSON; read it as text
  }
  if (isBundle(j)) return fromBundle(j, eventId)
  if (j && typeof j === 'object') {
    const t = j as TranscriptFile
    if (!Array.isArray(t.segments) || !Array.isArray(t.speakers)) throw new Error('JSON transcripts need "speakers" and "segments" lists.')
    checkJson(t)
    return { ...t, eventId }
  }
  const turns: { name: string; startMs: number; text: string; otter: boolean }[] = []
  let gap = true // a blank line ends an Otter block's text
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const last = turns[turns.length - 1]
    let m: RegExpMatchArray | null
    if (!line) gap = true
    else if ((m = line.match(HEADER))) turns.push({ name: m[1], startMs: ms(m[2]), text: '', otter: true })
    else if (last?.otter && !gap) last.text = last.text ? `${last.text} ${line}` : line
    else if ((m = line.match(BRACKET))) turns.push({ name: m[2].trim(), startMs: ms(m[1]), text: m[3], otter: false })
    else if ((m = line.match(PLAIN))) turns.push({ name: m[1].trim(), startMs: 0, text: m[2], otter: false })
    else if (last && !last.otter) last.text = `${last.text} ${line}`
    if (line) gap = false
  }
  const kept = turns.filter((t) => t.text)
  if (!kept.length) throw new Error(NO_TURNS)
  const labels = new Map<string, string>()
  for (const t of kept) if (!labels.has(t.name)) labels.set(t.name, `S${labels.size + 1}`)
  return {
    eventId,
    speakers: [...labels].map(([name, label]) => ({ label, name })),
    segments: kept.map((t, i) => ({ id: i, speaker: labels.get(t.name)!, startMs: t.startMs, text: t.text })),
  }
}

const STOP = new Set('about after again also because been before being could does doing done from going have here into just know like make maybe more most much need only other over really said should since some still such than that their them then there these they thing think this those through want well were what when where which while will with would your yeah okay right sure next week today time first last good great take mean people want thanks'.split(' '))
const words = (t: string) =>
  (t.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).map((w) => w.replace(/'s$|s$/, '')).filter((w) => w.length >= 4 && !STOP.has(w))

// A commitment: a first-person promise, not a hedge ("I'll be honest") or a question.
const CUE = /\b(?:I'll|I will|I can|let me|I'm going to)\s+(?:take that:\s*)?(?!be\b|admit|say\b|bet\b|need\b|have to\b|try\b|see\b|think\b)([a-z].*)$/i

function analyze(model: Model, meetingId: string, tr: TranscriptFile) {
  const meeting = model.meetingById.get(meetingId)
  if (!meeting) throw new Error(`Unknown meeting ${meetingId}`)
  const attendees = meeting.attendeeIds.map((id) => model.people.get(id)!).filter(Boolean)

  const speakerMap: Record<string, string> = {}
  for (const s of tr.speakers) {
    const n = s.name.trim().toLowerCase()
    const hits = attendees.filter((p) => p.name.toLowerCase() === n || p.name.toLowerCase().split(' ')[0] === n)
    if (hits.length === 1) speakerMap[s.label] = hits[0].id
  }

  // Each theme's words, from the other meetings' tagged turns: words used in several of its turns and
  // mostly within it. The theme's own name counts too.
  const text = new Map<string, string>()
  for (const m of model.meetings) if (m.id !== meetingId) for (const t of m.transcript ?? []) text.set(t.id, t.text)
  const total = new Map<string, number>()
  for (const t of text.values()) for (const w of new Set(words(t))) total.set(w, (total.get(w) ?? 0) + 1)
  const vocab = new Map<string, Set<string>>()
  for (const th of model.themes) {
    const inTheme = new Map<string, number>()
    for (const id of th.turnIds) if (text.has(id)) for (const w of new Set(words(text.get(id)!))) inTheme.set(w, (inTheme.get(w) ?? 0) + 1)
    const v = new Set(words(th.name))
    for (const [w, n] of inTheme) if (n >= 2 && n / total.get(w)! >= 0.6) v.add(w)
    vocab.set(th.id, v)
  }

  const themeMentions: Record<string, string[]> = {}
  const turnHits = new Map<string, [string, number][]>()
  for (const seg of tr.segments) {
    const id = `${meetingId}#${seg.id}`
    const ws = new Set(words(seg.text))
    const hits: [string, number][] = []
    for (const [th, v] of vocab) {
      const n = [...ws].filter((w) => v.has(w)).length
      if (n >= 1) {
        ;(themeMentions[th] ??= []).push(id)
        hits.push([th, n])
      }
    }
    turnHits.set(id, hits)
  }
  const themeIds = Object.keys(themeMentions).filter((th) => themeMentions[th].length >= 2 || meeting.themeIds.includes(th))
  // An item's theme: the turn's best match, preferring a theme the meeting really discusses, then the
  // one the meeting mentions most. One stray word shouldn't pull it into an unrelated theme.
  const rank = ([th, n]: [string, number]) => [themeIds.includes(th) ? 1 : 0, n, themeMentions[th].length]
  const themeOf = (id: string) =>
    [...(turnHits.get(id) ?? [])].sort((a, b) => {
      const [x, y] = [rank(a), rank(b)]
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
    })[0]?.[0]

  const others = model.actionItems.filter((a) => a.meetingId !== meetingId)
  const itemFor = (segId: number, ownerId: string, body: string): Extracted['actionItems'][number] => {
    const itemText = body[0].toUpperCase() + body.slice(1)
    const id = `${meetingId}#${segId}`
    const mine = new Set(words(itemText))
    const same = others.find((a) => {
      const theirs = new Set(words(a.text))
      const shared = [...mine].filter((w) => theirs.has(w)).length
      return shared / new Set([...mine, ...theirs]).size >= 0.5
    })
    return {
      id: `imp_${id}`,
      text: itemText,
      ownerId,
      meetingId,
      sourceTurnId: id,
      themeId: themeOf(id) ?? meeting.themeIds[0] ?? null,
      topicKey: same?.topicKey ?? [...mine].slice(0, 4).join('-'),
      status: 'open',
    }
  }

  const actionItems: Extracted['actionItems'] = []
  for (const seg of tr.segments) {
    const owner = speakerMap[seg.speaker]
    if (!owner) continue
    const sentence = rulesSentence(seg.text)
    if (!sentence) continue
    actionItems.push(itemFor(seg.id, owner, sentence.match(CUE)![1].replace(/[.!]+$/, '').trim()))
  }
  return { meeting, attendees, speakerMap, themeMentions, themeIds, actionItems, itemFor }
}

// The plain rule (spec 006): the sentence with a first-person promise, not a hedge or a question.
export const rulesSentence = (text: string) => text.split(/(?<=[.!?])\s+/).find((x) => CUE.test(x) && !x.trim().endsWith('?'))

export function extractAnnotations(model: Model, meetingId: string, tr: TranscriptFile): Extracted {
  const { speakerMap, themeMentions, themeIds, actionItems } = analyze(model, meetingId, tr)
  return { speakerMap, themeMentions, themeIds, actionItems }
}

export type Confirm = (items: JevItem[]) => Promise<JevAnswer[]>

// Spec 007 FR-001 to FR-005: the widened rules propose, Jev confirms through the dev-server proxy, and
// decide() sorts each candidate. Text is redacted before any request is built; saved answers for the
// same redacted state are reused instead of asked again (research R8).
export async function extractWithJev(
  model: Model, meetingId: string, tr: TranscriptFile, confirm: Confirm, saved: JevAnswer[] = [], bundle: { answers: JevAnswer[]; mismatched: string[] } | null = null,
): Promise<Extracted & { jev: JevImport }> {
  const a = analyze(model, meetingId, tr)
  const rulesBy = new Map(a.actionItems.map((x) => [x.sourceTurnId, x]))
  const candidates = proposeCandidates(tr, a.speakerMap)
  const nameOf = new Map(tr.speakers.map((s) => [s.label, s.name]))
  const turnsIn = tr.segments.map((g) => ({ id: `${meetingId}#${g.id}`, speaker: nameOf.get(g.speaker) ?? 'Unknown', text: g.text }))
  // Everyone who speaks is a possible owner too: with only the invite to choose from, Jev would pin a
  // promise by someone not on it on whoever is (found end to end with Atlas). Such an owner maps to no one.
  const unmapped = tr.speakers.filter((sp) => !a.speakerMap[sp.label]).map((sp) => sp.name)
  const owners = [...new Set([...a.attendees.map((p) => p.name), ...unmapped])]
  const { items, forms } = buildJevItems(a.meeting.title, owners, turnsIn, candidates.map((c) => c.turnId))

  const reuse = new Map<string, JevAnswer>()
  const fromAtlas = new Set<string>()
  for (const a of bundle?.answers ?? []) {
    reuse.set(a.turnId, a)
    fromAtlas.add(a.turnId)
  }
  for (const it of items) {
    if (reuse.has(it.turn_id)) continue
    const { turn_id, ...state } = it
    const hash = await stateHash(state)
    const old = saved.find((s) => s.turnId === turn_id && reusable(s, { questionSet: qs.question_set, model: qs.model, sentHash: hash }) === 'reuse')
    if (old) reuse.set(turn_id, old)
  }
  const ask = items.filter((it) => !reuse.has(it.turn_id))
  // Any found value or sensitive pattern left in what would be sent: send nothing, rules decide (FR-008).
  const blocked = leakedTurns(ask, forms).length > 0
  const fresh = !ask.length ? [] : blocked ? ask.map((it) => blockedAnswer(it.turn_id)) : await confirm(ask)
  const answers = items.map((it) => reuse.get(it.turn_id) ?? fresh.find((x) => x.turnId === it.turn_id) ?? null)

  const decisions: ImportDecision[] = []
  const actionItems: Extracted['actionItems'] = []
  candidates.forEach((c, k) => {
    const d = decide({ candidate: c, answer: answers[k], rulesSay: rulesBy.has(c.turnId), attendees: a.attendees, fromBundle: fromAtlas.has(c.turnId) })
    if (!d) return
    decisions.push(d)
    if (d.outcome === 'set-aside' || !d.ownerId) return
    const seg = tr.segments.find((g) => `${meetingId}#${g.id}` === c.turnId)!
    const rules = rulesBy.get(c.turnId)
    actionItems.push(rules ? { ...rules, ownerId: d.ownerId } : a.itemFor(seg.id, d.ownerId, cueSentence(seg.text)))
  })
  return {
    speakerMap: a.speakerMap, themeMentions: a.themeMentions, themeIds: a.themeIds, actionItems,
    jev: { used: answers.some((x) => x?.status === 'ok'), answers: answers.filter((x): x is JevAnswer => !!x), decisions, mismatched: bundle?.mismatched ?? [] },
  }
}

const blockedAnswer = (turnId: string): JevAnswer => ({
  turnId, questionSet: qs.question_set, model: qs.model, sentHash: '', commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason: 'redaction-blocked',
})

// The sentence holding the promise, for a turn the plain rules didn't word as an item.
function cueSentence(text: string) {
  const parts = text.split(/(?<=[.!?])\s+/)
  return (parts.find((x) => /\b(?:I['’]ll|I will|I['’]m|let me|I can|we['’]ll|we will)\b/i.test(x)) ?? text).replace(/[.!?]+$/, '').trim()
}

// What an import adds: commitments, plus the "needs a look" lines the lead ticked (FR-004).
export function keptItems(imp: Import): Import['actionItems'] {
  if (!imp.jev) return imp.actionItems
  const keep = new Set(imp.jev.decisions.filter((d) => d.outcome === 'commitment' || (d.outcome === 'needs-a-look' && d.selected)).map((d) => d.turnId))
  return imp.actionItems.filter((x) => keep.has(x.sourceTurnId))
}

// The bundled files with one meeting's transcript and annotations replaced by an import; applying
// the same import twice gives the same files. buildModel validates the result like any other data.
export function applyImport(files: Files, imp: Import): Files {
  const id = imp.transcript.eventId
  const a = files.annotations
  const mine = (t: string) => t.startsWith(`${id}#`)
  return {
    calendar: files.calendar,
    transcripts: { ...files.transcripts, [id]: imp.transcript },
    annotations: {
      ...a,
      speakerMap: { ...a.speakerMap, [id]: imp.speakerMap },
      meetings: { ...a.meetings, [id]: { ...a.meetings[id], themeIds: [...new Set([...a.meetings[id].themeIds, ...imp.themeIds])] } },
      themes: a.themes.map((t) => ({ ...t, mentions: [...t.mentions.filter((x) => !mine(x)), ...(imp.themeMentions[t.id] ?? [])] })),
      actionItems: [...a.actionItems.filter((x) => x.meetingId !== id), ...imp.actionItems],
    },
  }
}

// The model from the bundled files plus saved imports. An import that no longer applies (its meeting is
// gone, or the result fails validation) is skipped and named, so one bad import can't blank the calendar.
export function buildWithImports(files: Files, imports: Record<string, Import>, now?: Date): { model: Model; skipped: string[] } {
  let f = files
  const skipped: string[] = []
  for (const imp of Object.values(imports)) {
    try {
      const next = applyImport(f, imp)
      const built = buildModel(next.calendar, next.transcripts, next.annotations, now)
      if (built.meetingById.get(imp.transcript.eventId)?.upcoming) throw new Error('not happened yet') // nothing is recorded before it happens
      f = next
    } catch {
      skipped.push(imp.transcript.eventId)
    }
  }
  return { model: buildModel(f.calendar, f.transcripts, f.annotations, now), skipped }
}

// Why Jev didn't decide this import, when it didn't (FR-008: the reason is shown).
export function jevReason(jev: JevImport): UnavailableReason | null {
  return jev.used ? null : jev.answers.find((a) => a.reason)?.reason ?? null
}

// Lines Jev left to the rules when it answered others (FR-014), with the most common reason.
export function jevGaps(jev: JevImport): { count: number; reason: UnavailableReason } | null {
  const missed = jev.used ? jev.answers.filter((a) => a.status !== 'ok' && a.reason) : []
  if (!missed.length) return null
  const n = new Map<UnavailableReason, number>()
  for (const a of missed) n.set(a.reason!, (n.get(a.reason!) ?? 0) + 1)
  return { count: missed.length, reason: [...n].sort((a, b) => b[1] - a[1])[0][0] }
}
