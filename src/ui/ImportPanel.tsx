import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { bundleAnswers, extractAnnotations, extractWithJev, jevGaps, jevReason, keptItems, parseTranscript, type Import } from '../data/extract'
import { confirmCandidates, jevStatus, type JevStatus } from '../jev/client'
import type { ImportDecision, JevAnswer, UnavailableReason } from '../jev/types'
import type { Model } from '../data/types'
import { when } from './format'
import { Icon } from './Icon'

type Props = {
  model: Model // before privacy, so any meeting can take a transcript
  imports: Record<string, Import>
  onApply: (imp: Import) => string | null // null = applied; otherwise why it wasn't
  onRemove: (meetingId: string) => void
  onClose: () => void
}

// Paste one transcript, see what the rules find, then add it (spec 006 FR-032). Runs in this browser only.
export function ImportPanel({ model, imports, onApply, onRemove, onClose }: Props) {
  const tz = model.timeZone
  // Only meetings that have happened can have a transcript.
  const past = model.meetings.filter((m) => !m.upcoming)
  const firstEmpty = past.find((m) => !m.transcript)?.id ?? past[0]?.id ?? ''
  const [meetingId, setMeetingId] = useState(firstEmpty)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<Import | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Jev (spec 007): offered only where the dev-server proxy answers; off until the lead turns it on.
  const [jev, setJev] = useState<JevStatus | null>(null)
  const [useJev, setUseJev] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastAnswers, setLastAnswers] = useState<JevAnswer[]>([])
  useEffect(() => void jevStatus().then(setJev), [])
  const name = (id: string) => model.people.get(id)?.name ?? id
  const themeName = (id: string | null) => model.themes.find((t) => t.id === id)?.name ?? 'No theme'

  const read = async () => {
    setProblem(null)
    try {
      const transcript = parseTranscript(text, meetingId)
      const bundle = bundleAnswers(text, meetingId) // an Atlas bundle's own Jev answers, used even with Jev off (FR-012)
      const asking = useJev && jev?.available
      if (!asking && !bundle) return setPreview({ transcript, ...extractAnnotations(model, meetingId, transcript) })
      setBusy(true)
      const saved = [...lastAnswers, ...(imports[meetingId]?.jev?.answers ?? [])] // reused when the redacted text matches (R8)
      const notAsked = (reason: UnavailableReason) => async (items: { turn_id: string }[]): Promise<JevAnswer[]> =>
        items.map((it) => ({ turnId: it.turn_id, questionSet: 'mt-turn-1', model: 'jev-1.13.0', sentHash: '', commitment: null, ownerA: null, ownerB: null, status: 'unavailable', reason }))
      const confirm = asking ? confirmCandidates : notAsked(jev && !jev.available ? jev.reason : 'off')
      const out = await extractWithJev(model, meetingId, transcript, confirm, saved, bundle)
      setLastAnswers(out.jev.answers)
      setPreview({ transcript, ...out })
    } catch (e) {
      setPreview(null)
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const tick = (turnId: string) =>
    setPreview((p) => p?.jev ? { ...p, jev: { ...p.jev, decisions: p.jev.decisions.map((d) => (d.turnId === turnId ? { ...d, selected: !d.selected } : d)) } } : p)
  const apply = () => {
    if (!preview) return
    const why = onApply({ ...preview, actionItems: keptItems(preview) })
    if (why) setProblem(why)
    else {
      setPreview(null)
      setText('')
    }
  }

  return (
    <motion.div
      className="privacy import"
      role="dialog"
      aria-label="Import a transcript"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      <button className="pop-close" onClick={onClose} aria-label="Close import"><Icon name="close" /></button>
      <h2>Import a transcript</h2>
      <p className="privacy-where">
        Paste a transcript for one meeting: an Otter export, lines like “Name: what they said”, or the JSON shape in <code>data/transcripts</code>.{' '}
        {useJev ? 'With Jev on, the lines that might be promises are sent to TypeSafe, with sensitive numbers and dates removed first.' : "It's read in this browser and nothing is sent anywhere."}
      </p>
      <p className="privacy-where muted">
        Plain rules find the themes and promises (“I'll…”, “Let me…”), learned from the meetings already here. They miss commitments phrased without a cue, so check the preview.
      </p>
      <div className="import-form">
        <label>
          Meeting
          <select value={meetingId} onChange={(e) => { setMeetingId(e.target.value); setPreview(null) }}>
            {past.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}, {when(m, tz)}{imports[m.id] ? ' (imported)' : m.transcript ? ' (has a transcript)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Transcript
          <textarea value={text} rows={8} onChange={(e) => { setText(e.target.value); setPreview(null) }} placeholder={'Sam Rivera  0:05\nThanks for making time.\n\nDev Patel  0:12\nI\'ll pull the study notes into one folder by Friday.'} />
        </label>
        {jev && (jev.available || jev.reason !== 'not-on-this-build') && (
          <div className="import-jev-box">
            <label className="import-jev">
              <input type="checkbox" checked={useJev && jev.available} disabled={!jev.available} onChange={(e) => { setUseJev(e.target.checked); setPreview(null) }} />
              Check promises with Jev
            </label>
            {!jev.available && <p className="muted">{OFF_HERE[jev.reason] ?? OFF_HERE.default}</p>}
            {useJev && jev.available && (
              <p className="muted">
                Turning this on sends this transcript's text to TypeSafe, a third party. Social Security digits, dates of birth, and card and account numbers are replaced before anything is sent.{' '}
                <a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">TypeSafe's privacy policy</a>
              </p>
            )}
          </div>
        )}
        <div className="qi-actions">
          <button className="primary" disabled={!text.trim() || busy} onClick={read}>{busy ? 'Asking Jev…' : 'Preview'}</button>
          {preview && <button className="primary" onClick={apply}>Add to the calendar</button>}
        </div>
        {problem && <p className="import-problem" role="alert">{problem}</p>}
      </div>
      {preview && (
        <div className="import-preview" aria-label="What was found">
          <h3>Speakers</h3>
          <ul>
            {preview.transcript.speakers.map((s) => (
              <li key={s.label}>{s.name} → {preview.speakerMap[s.label] ? name(preview.speakerMap[s.label]) : <span className="muted">not on the invite, shown as unknown</span>}</li>
            ))}
          </ul>
          <h3>Themes</h3>
          <p>{preview.themeIds.length ? preview.themeIds.map(themeName).join(', ') : <span className="muted">None found</span>} · {preview.transcript.segments.length} turns</p>
          {preview.jev && jevReason(preview.jev) && <p className="import-problem" role="status">{WHY_RULES[jevReason(preview.jev)!] ?? WHY_RULES.error}</p>}
          {preview.jev && jevGaps(preview.jev) && (
            <p className="import-problem" role="status">
              Jev unavailable for {jevGaps(preview.jev)!.count} {jevGaps(preview.jev)!.count === 1 ? 'line' : 'lines'} ({GAP[jevGaps(preview.jev)!.reason] ?? jevGaps(preview.jev)!.reason}); the plain rules decided {jevGaps(preview.jev)!.count === 1 ? 'it' : 'them'}.
            </p>
          )}
          {preview.jev ? (
            <JevGroups imp={preview} name={name} onTick={tick} />
          ) : (<>
          <h3>Action items</h3>
          {preview.actionItems.length ? (
            <ul>
              {preview.actionItems.map((a) => (
                <li key={a.id}><b>{a.text}</b> <span className="muted">· {name(a.ownerId)} · {themeName(a.themeId)} · rules only</span></li>
              ))}
            </ul>
          ) : (
            <p className="muted">None found</p>
          )}
          </>)}
        </div>
      )}
      {Object.keys(imports).length > 0 && (
        <div className="import-done">
          <h3>Imported</h3>
          <ul>
            {Object.values(imports).map((imp) => {
              const m = model.meetingById.get(imp.transcript.eventId)
              return (
                <li key={imp.transcript.eventId}>
                  <span>{m ? `${m.title}, ${when(m, tz)}` : imp.transcript.eventId}</span>
                  <span className="muted">{imp.transcript.segments.length} turns · {imp.actionItems.length} action items{imp.jev?.used ? ' · Jev' : ''}</span>
                  <button className="btn" onClick={() => onRemove(imp.transcript.eventId)}>Remove</button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

// Why the Jev option is greyed out (FR-014). A published page has no Jev and shows no option at all.
const OFF_HERE: Partial<Record<UnavailableReason, string>> & { default: string } = {
  'no-key': "Jev isn't set up on this machine (no TYPESAFE_API_KEY for the dev server). The plain rules find promises.",
  off: 'Jev is off here (JEV_ENABLED=0). The plain rules find promises.',
  default: "Jev can't be reached right now. The plain rules find promises.",
}
const GAP: Partial<Record<UnavailableReason, string>> = { 'key-refused': 'Jev refused the key', 'error 0': 'no answer', 'error 529': 'Jev was busy', 'error 429': 'Jev was busy' }

// Shown when Jev was on but the plain rules decided (FR-008).
const WHY_RULES: Partial<Record<UnavailableReason, string>> & { error: string } = {
  'redaction-blocked': 'Nothing was sent: a sensitive detail was still in the text after redaction. These are the plain rules’ results.',
  'no-key': 'Jev has no key on this server, so the plain rules decided.',
  'key-refused': 'Jev refused the key, so the plain rules decided.',
  off: 'Jev is turned off on this server, so the plain rules decided.',
  'not-on-this-build': 'Jev only runs from the local dev server, so the plain rules decided.',
  error: 'Jev didn’t answer, so the plain rules decided.',
}

// The preview with Jev on (FR-004, FR-005): commitments, lines to check, and how many were set aside.
function JevGroups({ imp, name, onTick }: { imp: Import; name: (id: string) => string; onTick: (turnId: string) => void }) {
  const decisions = imp.jev!.decisions
  const item = (d: ImportDecision) => imp.actionItems.find((a) => a.sourceTurnId === d.turnId)
  const turn = (d: ImportDecision) => imp.transcript.segments.find((g) => `${imp.transcript.eventId}#${g.id}` === d.turnId)?.text ?? ''
  const by = (d: ImportDecision) => (d.decidedBy === 'rules' ? 'rules only' : `Jev ${d.rating!.toFixed(2)}${d.decidedBy === 'bundle' ? ' (from Atlas)' : ''}`)
  const mismatched = imp.jev!.mismatched?.length ?? 0
  const who = (d: ImportDecision) => (d.ownerId ? name(d.ownerId) : 'speaker not on the invite') + (d.ownerUnsure ? ', owner unsure' : '')
  const yes = decisions.filter((d) => d.outcome === 'commitment')
  const look = decisions.filter((d) => d.outcome === 'needs-a-look')
  const aside = decisions.filter((d) => d.outcome === 'set-aside').length
  return (
    <>
      {mismatched > 0 && (
        <p className="muted">
          {mismatched} of Atlas's answers were made with a different version of the questions or of Jev, so {mismatched === 1 ? 'that line was' : 'those lines were'} treated as unanswered.
        </p>
      )}
      <h3>Commitments</h3>
      {yes.length ? (
        <ul>
          {yes.map((d) => (
            <li key={d.turnId}><b>{item(d)?.text ?? turn(d)}</b> <span className="muted">· {who(d)} · {by(d)}</span></li>
          ))}
        </ul>
      ) : (
        <p className="muted">None found</p>
      )}
      {look.length > 0 && (
        <>
          <h3>Needs a look</h3>
          <p className="muted">Jev wasn't sure. Tick the ones to add.</p>
          <ul>
            {look.map((d) => (
              <li key={d.turnId}>
                <label>
                  <input type="checkbox" checked={d.selected} disabled={!d.ownerId} onChange={() => onTick(d.turnId)} /> <b>{item(d)?.text ?? turn(d)}</b>{' '}
                  <span className="muted">· {who(d)} · {by(d)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {aside > 0 && <p className="muted">{aside} proposed {aside === 1 ? 'line' : 'lines'} set aside</p>}
    </>
  )
}
