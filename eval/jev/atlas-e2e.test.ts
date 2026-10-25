// End to end with a running Atlas (spec 007 US3): live bundles go through the app's own import path
// (extractWithJev → client → browser scan → proxy → Jev) and the result is compared with Atlas's own
// action items. Turns that carry Atlas's mt-turn-1 answers must not be asked again; a second run asks Jev
// directly (bundle answers ignored) to check Atlas's answers match Meeting Threads' own. Turns Atlas left
// unanswered are filled in as contracts/atlas-bundle.md describes and the import repeated: nothing may be
// asked then. Skipped when Atlas isn't running.
// ATLAS_URL defaults to http://127.0.0.1:8765. Prints turn ids and counts, never turn text.
import { expect, it } from 'vitest'
import qs from '../../scripts/jev/questions.json'
import { bundleAnswers, extractWithJev, parseTranscript } from '../../src/data/extract'
import { confirmCandidates } from '../../src/jev/client'
import { handleConfirm } from '../../src/jev/proxy'
import type { JevAnswer } from '../../src/jev/types'
import { tinyModel } from '../../tests/fixtures'

const ATLAS = process.env.ATLAS_URL ?? 'http://127.0.0.1:8765'
const MEETINGS = ['mtg-01-diego-1on1', 'mtg-02-maya-1on1', 'mtg-03-reza-peer-sync', 'mtg-04-vendor-unlabeled', 'mtg-05-priya-stakeholder']

type Bundle = {
  meeting: { title: string }
  people: { person_id: string; name: string }[]
  turns: { turn_id: string; person_id: string; text: string; jev?: unknown }[]
  action_items: { turn_id: string; owner_person_id: string }[]
}

// The browser client, with /api/jev/confirm answered in-process by the proxy and a real call to Jev.
const viaProxy = ((url: string, init: RequestInit) =>
  handleConfirm(JSON.parse(String(init.body)), process.env, fetch, () => {}).then((r) => new Response(JSON.stringify(r.body), { status: r.status }))) as unknown as typeof fetch
const confirm = (items: Parameters<typeof confirmCandidates>[0]) => confirmCandidates(items, viaProxy)

const up = await fetch(`${ATLAS}/`).then((r) => r.ok).catch(() => false)

it.skipIf(!up)('imports every live Atlas bundle, agrees with Atlas, and reuses answers once Atlas carries them', async () => {
  expect(process.env.TYPESAFE_API_KEY, 'set TYPESAFE_API_KEY in the environment').toBeTruthy()
  const rows = []
  for (const id of MEETINGS) {
    const b: Bundle = await fetch(`${ATLAS}/api/meeting_bundle?meeting_id=${id}`).then((r) => r.json())
    const names = b.people.map((p) => p.name)
    const m = tinyModel([{ id, attendees: names }])
    const mt = m.meetingById.get(id)!
    mt.title = b.meeting.title
    mt.attendeeIds = names // no extra lead: the attendees Jev chooses from are the bundle's people
    const text = JSON.stringify(b)
    const tr = parseTranscript(text, id)
    const toAtlas = (turnId: string) => b.turns[Number(turnId.split('#')[1])].turn_id

    // 1. Import the live bundle: only turns without Atlas's answers may be asked.
    const liveAsked: string[] = []
    const counting = (items: Parameters<typeof confirm>[0]) => (liveAsked.push(...items.map((i) => i.turn_id)), confirm(items))
    const fromAtlas = bundleAnswers(text, id)!
    const first = await extractWithJev(m, id, tr, counting, [], fromAtlas)
    // Meeting Threads asking Jev itself, for comparison with Atlas's answers.
    const own = await extractWithJev(m, id, tr, confirm, [], null)
    const ownBy = new Map(own.jev.answers.filter((a) => a.status === 'ok').map((a) => [a.turnId, a.commitment!]))
    const diffs = fromAtlas.answers.filter((a) => ownBy.has(a.turnId)).map((a) => Math.abs(a.commitment! - ownBy.get(a.turnId)!))
    const sameOutcome = JSON.stringify(own.jev.decisions.map((d) => [d.turnId, d.outcome])) === JSON.stringify(first.jev.decisions.map((d) => [d.turnId, d.outcome]))
    const atlasItems = new Map(b.action_items.map((a) => [a.turn_id, b.people.find((p) => p.person_id === a.owner_person_id)?.name ?? null]))
    const mtItems = new Map(first.actionItems.map((a) => [toAtlas(a.sourceTurnId), a.ownerId]))
    const look = first.jev.decisions.filter((d) => d.outcome === 'needs-a-look').map((d) => toAtlas(d.turnId))

    // 2. The answers written into the bundle as Atlas will, then imported again: nothing is asked.
    const byTurn = new Map(first.jev.answers.filter((a) => a.status === 'ok').map((a) => [toAtlas(a.turnId), a]))
    const withJev = { ...b, turns: b.turns.map((t) => {
      const a = byTurn.get(t.turn_id)
      return a ? { ...t, jev: { question_set: a.questionSet, model: a.model, sent_hash: a.sentHash, commitment: a.commitment, owner_a: a.ownerA, owner_b: a.ownerB } } : t
    }) }
    const text2 = JSON.stringify(withJev)
    const asked: unknown[] = []
    const again = await extractWithJev(m, id, parseTranscript(text2, id), async (items) => (asked.push(...items), [] as JevAnswer[]), [], bundleAnswers(text2, id))

    rows.push({
      meeting: id,
      turns: b.turns.length,
      atlasAnswered: fromAtlas.answers.length,
      mismatched: fromAtlas.mismatched.length,
      liveAsked: liveAsked.length,
      fromAtlasDecisions: first.jev.decisions.filter((d) => d.decidedBy === 'bundle').length,
      maxRatingDiff: diffs.length ? +Math.max(...diffs).toFixed(2) : null,
      sameOutcomeAsOwn: sameOutcome,
      atlas: [...atlasItems.keys()],
      mt: [...mtItems.keys()],
      needsALook: look,
      ownersAgree: [...mtItems].filter(([t, o]) => atlasItems.has(t) && atlasItems.get(t) === o).length,
      jevUsed: first.jev.used,
      unanswered: first.jev.answers.filter((a) => a.status !== 'ok').map((a) => a.reason),
      reimportAsked: asked.length,
      reimportFromBundle: again.jev.decisions.filter((d) => d.decidedBy === 'bundle').length,
      reimportSame: JSON.stringify(again.actionItems.map((a) => [a.sourceTurnId, a.ownerId])) === JSON.stringify(first.actionItems.map((a) => [a.sourceTurnId, a.ownerId])),
    })
  }
  const atlasN = rows.reduce((n, r) => n + r.atlas.length, 0)
  const both = rows.reduce((n, r) => n + r.mt.filter((t) => r.atlas.includes(t)).length, 0)
  const mtN = rows.reduce((n, r) => n + r.mt.length, 0)
  console.log(JSON.stringify({ atlas: ATLAS, question_set: qs.question_set, rows, total: { atlasItems: atlasN, mtItems: mtN, both, ownersAgree: rows.reduce((n, r) => n + r.ownersAgree, 0) } }, null, 1))
  for (const r of rows) {
    expect(r.reimportAsked, `${r.meeting}: reimport asked Jev again`).toBe(0)
    expect(r.reimportSame, `${r.meeting}: reimport changed the result`).toBe(true)
  }
})
