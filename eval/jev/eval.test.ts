// Rules vs rules plus Jev on the labelled sets (spec 007 FR-015, R9). Calls Jev for real through the same
// redaction, browser scan and proxy code the app uses, so it runs only via `npm run eval:jev`. Prints counts,
// never transcript text. A private set (the real call) is read from $JEV_EVAL_PRIVATE_DIR, default
// ~/.meeting-threads-private, and reported as skipped when absent.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import qs from '../../scripts/jev/questions.json'
import { rulesSentence } from '../../src/data/extract'
import { proposeCandidates } from '../../src/jev/candidates'
import { buildJevItems, leakedTurns } from '../../src/jev/client'
import { handleConfirm } from '../../src/jev/proxy'
import { model } from '../../tests/fixtures'

type Turn = { id: string; speaker: string; text: string }
type EvalSet = { name: string; commitments: string[]; meetings: { title: string; attendees?: string[]; turns: Turn[] }[] }

function synthetic(): EvalSet {
  const m = model()
  const meetings = m.meetings.filter((x) => x.transcript?.length).map((x) => ({
    title: x.title,
    attendees: x.attendeeIds.map((id) => m.people.get(id)?.name ?? id),
    turns: x.transcript!.map((t) => ({ id: t.id, speaker: t.speakerId ? m.people.get(t.speakerId)?.name ?? 'Unknown' : 'Unknown', text: t.text })),
  }))
  return { name: 'mt-synthetic', commitments: m.actionItems.map((a) => a.sourceTurnId), meetings }
}
const fromFile = (p: string): EvalSet => JSON.parse(readFileSync(p, 'utf8'))
const here = (f: string) => fileURLToPath(new URL(`./sets/${f}`, import.meta.url))

const prf = (pred: Set<string>, gold: Set<string>) => {
  const tp = [...pred].filter((x) => gold.has(x)).length
  const p = pred.size ? tp / pred.size : 1
  const r = gold.size ? tp / gold.size : 1
  return { p: +p.toFixed(2), r: +r.toFixed(2), f1: +(p + r ? (2 * p * r) / (p + r) : 0).toFixed(2), tp, fp: pred.size - tp, fn: gold.size - tp }
}

async function run(set: EvalSet) {
  const gold = new Set(set.commitments)
  const rules = new Set<string>()
  const jev = new Set<string>()
  const proposed = new Set<string>()
  let look = 0
  let lookTrue = 0 // "Needs a look" lines that are labelled commitments: what the lead's review can recover
  let unanswered = 0
  let blocked = 0
  let turns = 0
  for (const mt of set.meetings) {
    turns += mt.turns.length
    mt.turns.forEach((t) => rulesSentence(t.text) && rules.add(t.id))
    // proposeCandidates reads only text and speaker; segment ids are indexes mapped back to the set's ids.
    const tr = { eventId: 'x', speakers: [], segments: mt.turns.map((t, i) => ({ id: i, speaker: t.speaker, startMs: 0, text: t.text })) }
    const ids = proposeCandidates(tr, {}).map((c) => mt.turns[Number(c.turnId.split('#')[1])].id)
    ids.forEach((id) => proposed.add(id))
    const attendees = mt.attendees ?? [...new Set(mt.turns.map((t) => t.speaker))]
    const { items, forms } = buildJevItems(mt.title, attendees, mt.turns, ids)
    const fallback = (id: string) => rules.has(id) && jev.add(id)
    if (!items.length) continue
    if (leakedTurns(items, forms).length) {
      blocked++
      ids.forEach(fallback)
      continue
    }
    for (let i = 0; i < items.length; i += 200) {
      const r = await handleConfirm({ question_set: qs.question_set, items: items.slice(i, i + 200) }, process.env, fetch, () => {})
      const answers = r.status === 200 ? (r.body as { answers: { turn_id: string; status: string; commitment?: number }[] }).answers : []
      for (const it of items.slice(i, i + 200)) {
        const a = answers.find((x) => x.turn_id === it.turn_id)
        if (a?.status !== 'ok' || typeof a.commitment !== 'number') {
          unanswered++
          fallback(it.turn_id)
        } else if (a.commitment >= qs.thresholds.yes) jev.add(it.turn_id)
        else if (a.commitment > qs.thresholds.no) {
          look++
          if (gold.has(it.turn_id)) lookTrue++
        }
      }
    }
  }
  return {
    set: set.name, turns, labels: gold.size, candidates: proposed.size,
    candidateRecall: +([...gold].filter((g) => proposed.has(g)).length / (gold.size || 1)).toFixed(2),
    rules: prf(rules, gold), jev: prf(jev, gold), needsALook: look, needsALookTrue: lookTrue, unanswered, blockedMeetings: blocked,
  }
}

it('compares rules with rules plus Jev on every labelled set', async () => {
  expect(process.env.TYPESAFE_API_KEY, 'set TYPESAFE_API_KEY in the environment').toBeTruthy()
  const dir = process.env.JEV_EVAL_PRIVATE_DIR ?? join(homedir(), '.meeting-threads-private')
  const priv = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fromFile(join(dir, f))) : []
  const sets = [synthetic(), fromFile(here('atlas-scripted.json')), fromFile(here('mt-holdout.json')), ...priv]
  const rows = []
  for (const s of sets) rows.push(await run(s))
  if (!priv.length) rows.push({ set: 'private (real call)', skipped: `nothing in ${dir}` })
  const all = rows.filter((r): r is Awaited<ReturnType<typeof run>> => 'rules' in r)
  const sum = (k: 'rules' | 'jev') => {
    const tp = all.reduce((n, r) => n + r[k].tp, 0), fp = all.reduce((n, r) => n + r[k].fp, 0), fn = all.reduce((n, r) => n + r[k].fn, 0)
    const p = tp / (tp + fp || 1), rc = tp / (tp + fn || 1)
    return { p: +p.toFixed(2), r: +rc.toFixed(2), f1: +((2 * p * rc) / (p + rc || 1)).toFixed(2), tp, fp, fn }
  }
  const labels = all.reduce((n, r) => n + r.labels, 0)
  // SC-002 counts the lead's review: each "Needs a look" line that is a labelled commitment counts as ticked.
  const j = sum('jev'), looked = all.reduce((n, r) => n + r.needsALookTrue, 0)
  const rp = (j.tp + looked) / (j.tp + looked + j.fp || 1), rr = (j.tp + looked) / (j.tp + j.fn || 1)
  const afterReview = { p: +rp.toFixed(2), r: +rr.toFixed(2), f1: +((2 * rp * rr) / (rp + rr || 1)).toFixed(2) }
  const total = { rules: sum('rules'), jev: j, afterReview, candidateRecall: +(all.reduce((n, r) => n + r.candidateRecall * r.labels, 0) / labels).toFixed(2) }
  console.log(JSON.stringify({ question_set: qs.question_set, model: qs.model, thresholds: qs.thresholds, rows, total }, null, 1))
  expect(all.length).toBeGreaterThanOrEqual(3)
})
