// Builds data/calendar.json, data/transcripts/*.json and data/annotations.json from data/seed.json.
// Deterministic: a fixed seed drives every random pick, so `npm run gen` always gives the same files.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'))
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

// mulberry32
let s = 20261102
const rand = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const people = new Map(seed.people.map((p) => [p.id, p]))
const byShort = new Map(seed.people.map((p) => [p.id.split('@')[0], p.id]))
const id = (short) => {
  const v = byShort.get(short)
  if (!v) throw new Error(`seed: unknown person "${short}"`)
  return v
}
const themes = new Map(seed.themes.map((t) => [t.id, t]))

const dateOf = (week, day) => {
  const d = new Date(`${seed.window.start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7 + DAYS.indexOf(day))
  return d.toISOString().slice(0, 10)
}
const iso = (date, time, addMin = 0) => {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + addMin
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${date}T${hh}:${mm}:00${seed.utcOffset}`
}
const mmss = (t) => {
  const [m, sec] = t.split(':').map(Number)
  return (m * 60 + sec) * 1000
}

// 1. Expand series and stories into one meeting list.
const meetings = []
for (const ser of seed.series) {
  for (const week of ser.weeks) meetings.push({ ...ser, date: dateOf(week, ser.day), turns: null })
}
for (const st of seed.stories) meetings.push({ ...st, recorded: true })
meetings.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
meetings.forEach((m) => {
  m.id = `evt_${m.date.replaceAll('-', '')}_${m.time.replace(':', '')}`
  m.attendeeIds = [seed.lead, ...m.attendees.map(id)]
  m.startIso = iso(m.date, m.time)
  m.endIso = iso(m.date, m.time, m.minutes)
})

// 2. Fill transcripts for recorded series meetings from the theme phrase banks.
const phraseIdx = new Map()
for (const m of meetings) {
  if (!m.recorded || m.turns) continue
  m.turns = []
  let t = 30
  const speakers = m.attendeeIds
  for (const th of m.themes) {
    const bank = themes.get(th)
    for (let k = 0; k < 2; k++) {
      const i = phraseIdx.get(th) ?? 0
      phraseIdx.set(th, i + 1)
      const sp = speakers[Math.floor(rand() * speakers.length)]
      t += 40 + Math.floor(rand() * 200)
      m.turns.push({ speakerId: sp, ms: t * 1000, text: bank.phrases[i % bank.phrases.length], themes: [th] })
    }
    if (rand() < 0.5) {
      const a = bank.actions[Math.floor(rand() * bank.actions.length)]
      const owners = speakers.filter((p) => p !== seed.lead)
      const owner = owners.length && rand() < 0.75 ? owners[Math.floor(rand() * owners.length)] : seed.lead
      t += 30 + Math.floor(rand() * 90)
      m.turns.push({
        speakerId: owner, ms: t * 1000, text: `I'll take that: ${a.text[0].toLowerCase()}${a.text.slice(1)}.`, themes: [th],
        action: { key: a.key, text: a.text, owner, theme: th },
      })
    }
  }
}
// Story turns use short names; "?" is a speaker with no mapping.
for (const m of meetings) {
  if (!m.turns || m.turns[0]?.ms !== undefined) continue
  m.turns = m.turns.map((tu) => ({
    speakerId: tu.s === '?' ? null : id(tu.s), ms: mmss(tu.t), text: tu.text, themes: tu.themes ?? [],
    action: tu.action && { ...tu.action, owner: id(tu.action.owner) },
  }))
}

// 3. Self-checks: fail loud rather than ship a data set the demo depends on but doesn't have.
const fail = (msg) => { throw new Error(`generate-data: ${msg}`) }
for (let i = 1; i < meetings.length; i++) {
  const a = meetings[i - 1], b = meetings[i]
  if (Date.parse(b.startIso) < Date.parse(a.endIso)) fail(`overlap: ${a.id} "${a.title}" and ${b.id} "${b.title}"`)
}
for (const m of meetings) {
  for (const th of m.themes) if (!themes.has(th)) fail(`${m.id}: unknown theme ${th}`)
  for (const tu of m.turns ?? []) {
    if (tu.speakerId && !m.attendeeIds.includes(tu.speakerId)) fail(`${m.id}: speaker ${tu.speakerId} is not an attendee`)
    for (const th of tu.themes) if (!m.themes.includes(th)) fail(`${m.id}: turn theme ${th} not on meeting`)
  }
}
const types = new Set(meetings.map((m) => m.type))
if (types.size !== 6) fail(`expected all six meeting types, got ${[...types]}`)
if (!meetings.some((m) => m.attendeeIds.length >= 10)) fail('need one meeting with 10+ attendees')
if (!meetings.some((m) => m.turns?.some((t) => t.speakerId === null))) fail('need one unmapped speaker')
const themeCounts = new Map()
for (const m of meetings) for (const th of m.themes) themeCounts.set(th, (themeCounts.get(th) ?? 0) + 1)
if (![...themeCounts.values()].includes(1)) fail('need one theme that appears in a single meeting')
for (const [th, n] of themeCounts) if (n !== 1 && n < 4) fail(`theme ${th} is in only ${n} meetings`)

// 4. Write the three files.
rmSync('data/transcripts', { recursive: true, force: true })
mkdirSync('data/transcripts', { recursive: true })
const calendar = {
  timeZone: seed.timeZone,
  items: meetings.map((m) => ({
    id: m.id,
    summary: m.title,
    ...(m.agenda ? { description: `Agenda:\n${m.agenda.map((a) => `- ${a}`).join('\n')}` } : {}),
    start: { dateTime: m.startIso },
    end: { dateTime: m.endIso },
    attendees: m.attendeeIds.map((e) => ({ email: e, displayName: people.get(e).name, ...(e === seed.lead ? { self: true } : {}) })),
  })),
}
writeFileSync('data/calendar.json', JSON.stringify(calendar, null, 2) + '\n')

const speakerMap = {}
const mentions = new Map(seed.themes.map((t) => [t.id, []]))
const actionItems = []
let recorded = 0
for (const m of meetings) {
  if (!m.turns) continue
  recorded++
  const labels = new Map()
  const label = (sp) => {
    const key = sp ?? '?'
    if (!labels.has(key)) labels.set(key, `S${labels.size + 1}`)
    return labels.get(key)
  }
  const segments = m.turns.map((tu, i) => ({ id: i, speaker: label(tu.speakerId), startMs: tu.ms, text: tu.text }))
  writeFileSync(`data/transcripts/${m.id}.json`, JSON.stringify({
    eventId: m.id,
    speakers: [...labels].map(([sp, l]) => ({ label: l, name: sp === '?' ? 'Dial-in user' : people.get(sp).name })),
    segments,
  }, null, 2) + '\n')
  speakerMap[m.id] = Object.fromEntries([...labels].filter(([sp]) => sp !== '?').map(([sp, l]) => [l, sp]))
  m.turns.forEach((tu, i) => {
    const turnId = `${m.id}#${i}`
    for (const th of tu.themes) mentions.get(th).push(turnId)
    if (tu.action) actionItems.push({
      id: `ai_${String(actionItems.length + 1).padStart(2, '0')}`, text: tu.action.text, ownerId: tu.action.owner,
      meetingId: m.id, sourceTurnId: turnId, themeId: tu.action.theme, topicKey: tu.action.key, status: 'open',
    })
  })
}
const annotations = {
  window: seed.window,
  people: seed.people.map((p) => ({ id: p.id, name: p.name, role: p.role, discipline: p.discipline })),
  speakerMap,
  meetings: Object.fromEntries(meetings.map((m) => [m.id, { type: m.type, themeIds: m.themes }])),
  themes: seed.themes.map((t) => ({ id: t.id, name: t.name, color: t.color, mentions: mentions.get(t.id) })),
  actionItems,
  projects: (seed.projects ?? []).map((p) => {
    for (const t of p.themes) if (!themes.has(t)) fail(`project ${p.id}: unknown theme ${t}`)
    // Themes cut across projects; they are not projects under another name.
    if (p.themes.length < 2) fail(`project ${p.id} has fewer than two themes`)
    const words = (x) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
    for (const t of seed.themes)
      for (const w of words(t.name)) if (words(p.name).has(w)) fail(`theme "${t.name}" shares "${w}" with project "${p.name}"`)
    return { id: p.id, name: p.name, themeIds: p.themes }
  }),
}
for (const t of seed.themes)
  if ((seed.projects ?? []).filter((p) => p.themes.includes(t.id)).length < 2) fail(`theme ${t.id} runs through fewer than two projects`)
writeFileSync('data/annotations.json', JSON.stringify(annotations, null, 2) + '\n')
console.log(`${meetings.length} meetings, ${recorded} recorded, ${actionItems.length} action items, themes: ${[...themeCounts].map(([k, v]) => `${k}=${v}`).join(' ')}`)
