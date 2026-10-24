import { motion } from 'motion/react'
import type { Model } from '../data/types'
import { Icon } from './Icon'
import type { Persisted } from '../store'
import { when } from './format'

type Props = {
  model: Model // the loaded model, before privacy is applied, so hidden transcripts can be shown again
  privacy: Persisted['privacy']
  saved: boolean
  onToggleHidden: (meetingId: string) => void
  onToggleExcluded: (personId: string) => void
  onClose: () => void
}

export function PrivacyPanel({ model, privacy, saved, onToggleHidden, onToggleExcluded, onClose }: Props) {
  const recorded = model.meetings.filter((m) => m.transcript)
  const people = [...model.people.values()].filter((p) => !p.isLead).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <motion.div
      className="privacy"
      role="dialog"
      aria-label="Privacy"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      <button className="pop-close" onClick={onClose} aria-label="Close privacy"><Icon name="close" /></button>
      <h2>Privacy</h2>
      <p className="privacy-where">
        {saved
          ? 'Calendar, transcripts, your notes and your decisions are stored in this browser only. Nothing is sent anywhere.'
          : 'This browser is not letting the app save, so changes last until you close the tab. Nothing is sent anywhere.'}
      </p>
      <p className="privacy-where">
        Your notes are only ever visible to you. An agenda item becomes visible to a meeting's attendees once you accept it.
      </p>
      <div className="privacy-cols">
        <section>
          <h3>Transcripts</h3>
          <p className="muted">Hiding one removes its quotes, action items and suggestions everywhere. The meeting stays on the calendar.</p>
          <ul>
            {recorded.map((m) => {
              const hidden = privacy.hiddenMeetingIds.includes(m.id)
              return (
                <li key={m.id}>
                  <label>
                    <input type="checkbox" checked={hidden} onChange={() => onToggleHidden(m.id)} />
                    <span>{m.title}</span>
                    <span className="muted">{when(m, model.timeZone)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
        <section>
          <h3>Leave out of suggestions</h3>
          <p className="muted">Suggestions stop drawing on what these people said. Their meetings and quotes still show.</p>
          <ul>
            {people.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={privacy.excludedPersonIds.includes(p.id)} onChange={() => onToggleExcluded(p.id)} />
                  <span>{p.name}</span>
                  <span className="muted" title={p.role}>{p.role}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </motion.div>
  )
}
