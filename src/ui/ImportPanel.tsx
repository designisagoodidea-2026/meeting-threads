import { motion } from 'motion/react'
import { useState } from 'react'
import { extractAnnotations, parseTranscript, type Import } from '../data/extract'
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
  const name = (id: string) => model.people.get(id)?.name ?? id
  const themeName = (id: string | null) => model.themes.find((t) => t.id === id)?.name ?? 'No theme'

  const read = () => {
    setProblem(null)
    try {
      const transcript = parseTranscript(text, meetingId)
      setPreview({ transcript, ...extractAnnotations(model, meetingId, transcript) })
    } catch (e) {
      setPreview(null)
      setProblem((e as Error).message)
    }
  }
  const apply = () => {
    if (!preview) return
    const why = onApply(preview)
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
        Paste a transcript for one meeting: an Otter export, lines like “Name: what they said”, or the JSON shape in <code>data/transcripts</code>. It's read in this browser and nothing is sent anywhere.
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
        <div className="qi-actions">
          <button className="primary" disabled={!text.trim()} onClick={read}>Preview</button>
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
          <h3>Action items</h3>
          {preview.actionItems.length ? (
            <ul>
              {preview.actionItems.map((a) => (
                <li key={a.id}><b>{a.text}</b> <span className="muted">· {name(a.ownerId)} · {themeName(a.themeId)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="muted">None found</p>
          )}
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
                  <span className="muted">{imp.transcript.segments.length} turns · {imp.actionItems.length} action items</span>
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
