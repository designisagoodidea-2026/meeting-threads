import { buildModel } from './load'
import type { AnnotationsFile, CalendarFile, Model, TranscriptFile } from './types'

// One pasted transcript into the same annotations the bundled data carries (spec 006 FR-032).
// Plain rules that run in the browser, so nothing is sent anywhere. They learn each theme's words from
// the other meetings' tagged turns. shortcut: rule-based, misses commitments phrased without a cue
// ("I'm comfortable proposing…"); an LLM pass would catch more, once sending text off-device is decided.

export type Extracted = {
  speakerMap: Record<string, string> // diarization label -> person id; unknown speakers left out
  themeMentions: Record<string, string[]> // theme id -> turn ids in this meeting
  themeIds: string[] // themes this meeting really discussed
  actionItems: AnnotationsFile['actionItems']
}
export type Import = Extracted & { transcript: TranscriptFile }
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

// Reads the bundled JSON shape, Otter-style "Name  m:ss" blocks, "[hh:mm:ss] Name: text" or "Name: text"
// lines. Inside an Otter block only a new header starts a turn; elsewhere unmatched lines wrap onto the last turn.
export function parseTranscript(text: string, eventId: string): TranscriptFile {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    // not JSON; read it as text
  }
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

export function extractAnnotations(model: Model, meetingId: string, tr: TranscriptFile): Extracted {
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

  const actionItems: Extracted['actionItems'] = []
  const others = model.actionItems.filter((a) => a.meetingId !== meetingId)
  for (const seg of tr.segments) {
    const owner = speakerMap[seg.speaker]
    if (!owner) continue
    const sentence = seg.text.split(/(?<=[.!?])\s+/).find((x) => CUE.test(x) && !x.trim().endsWith('?'))
    if (!sentence) continue
    const body = sentence.match(CUE)![1].replace(/[.!]+$/, '').trim()
    const itemText = body[0].toUpperCase() + body.slice(1)
    const id = `${meetingId}#${seg.id}`
    const mine = new Set(words(itemText))
    const same = others.find((a) => {
      const theirs = new Set(words(a.text))
      const shared = [...mine].filter((w) => theirs.has(w)).length
      return shared / new Set([...mine, ...theirs]).size >= 0.5
    })
    actionItems.push({
      id: `imp_${id}`,
      text: itemText,
      ownerId: owner,
      meetingId,
      sourceTurnId: id,
      themeId: themeOf(id) ?? meeting.themeIds[0] ?? null,
      topicKey: same?.topicKey ?? [...mine].slice(0, 4).join('-'),
      status: 'open',
    })
  }
  return { speakerMap, themeMentions, themeIds, actionItems }
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
export function buildWithImports(files: Files, imports: Record<string, Import>): { model: Model; skipped: string[] } {
  let f = files
  const skipped: string[] = []
  for (const imp of Object.values(imports)) {
    try {
      const next = applyImport(f, imp)
      buildModel(next.calendar, next.transcripts, next.annotations)
      f = next
    } catch {
      skipped.push(imp.transcript.eventId)
    }
  }
  return { model: buildModel(f.calendar, f.transcripts, f.annotations), skipped }
}
