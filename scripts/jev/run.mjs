// Sends prepared turn states to Jev (TypeSafe System One) and saves the answers. Reads the key from
// TYPESAFE_API_KEY only; never from a file. Usage: node scripts/jev/run.mjs <states.json> <answers.json>
// Each state is evaluated once per question_set; answers already saved for it are reused.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [statesPath, outPath] = process.argv.slice(2)
if (!statesPath || !outPath) throw new Error('usage: node scripts/jev/run.mjs <states.json> <answers.json>')
const key = process.env.TYPESAFE_API_KEY
if (!key) throw new Error('Set TYPESAFE_API_KEY in the environment first.')
const qs = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'))
// Ad hoc comparison runner: the shared commitment question plus the eval-only theme questions.
const themeQs = JSON.parse(readFileSync(new URL('../../eval/jev/theme-questions.json', import.meta.url), 'utf8'))
qs.themes = themeQs.themes
const questions = {
  commitment: { type: 'noul', instructions: qs.questions.commitment.instructions },
  ...Object.fromEntries(Object.entries(qs.themes).map(([id, def]) => [`theme_${id}`, { type: 'noul', instructions: `Does \`turn\` discuss ${def}?` }])),
}
const states = JSON.parse(readFileSync(statesPath, 'utf8'))
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { question_set: qs.question_set, model: qs.model, answers: {} }
if (out.question_set !== qs.question_set && out.question_set !== 'mt-turn-1') throw new Error(`${outPath} holds answers for ${out.question_set}, not ${qs.question_set}`)

async function ask(state, attempt = 0) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'MeetingThreads-JevEval/1.0' },
    body: JSON.stringify({ model: qs.model, state, questions }),
    signal: AbortSignal.timeout(20000),
  })
  if ((res.status === 429 || res.status === 529) && attempt < 5) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return ask(state, attempt + 1)
  }
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

const todo = states.filter((s) => !out.answers[s.id])
let done = 0, inTok = 0
const t0 = Date.now()
const worker = async () => {
  for (let s; (s = todo.shift()); ) {
    const t = Date.now()
    const r = await ask(s.state)
    const a = r.answers ?? {}
    out.answers[s.id] = {
      model: r.model,
      ms: Date.now() - t,
      commitment: a.commitment?.noul ?? null,
      themes: Object.fromEntries(Object.keys(qs.themes).map((id) => [id, a[`theme_${id}`]?.noul ?? null])),
    }
    inTok += r.usage?.input_tokens ?? 0
    if (++done % 20 === 0) writeFileSync(outPath, JSON.stringify(out, null, 1))
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
writeFileSync(outPath, JSON.stringify(out, null, 1))
console.log(`evaluated ${done} turns in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${inTok} input tokens; ${Object.keys(out.answers).length} saved`)
