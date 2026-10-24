import { motion } from 'motion/react'
import type { Model, Suggestion } from '../data/types'
import type { Item } from '../layout/layouts'
import { Cue } from './Cue'
import { Icon } from './Icon'
import { QueueLink } from './QueueLink'
import { itemCommitments } from '../threads/threads'
import { names, offset, speakerName, when } from './format'
import { themeColor } from './theme-colors'

const CARD_W = 300

// Popovers live in canvas-body coordinates; they open to the right of their anchor unless that would
// run off the stage, and stay inside the body vertically.
function place(x: number, y: number, stageW: number, bodyH: number, estH: number) {
  const left = x + 14 + CARD_W > stageW ? x - CARD_W - 14 : x + 14
  const top = Math.max(8, Math.min(y - 20, bodyH - estH - 8))
  return { left, top }
}

const pop = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}

export function BeadCard(props: {
  model: Model
  actionItemId: string
  done: boolean
  x: number
  y: number
  bodyH: number
  onClose: () => void
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  suggestions: Suggestion[]
  onShowInQueue: (id: string) => void
}) {
  const { model, actionItemId, done, x, y, bodyH, onClose, onOpenPerson, onOpenMeeting, suggestions, onShowInQueue } = props
  const queued = itemCommitments(model, suggestions).get(actionItemId)?.suggestionId
  const a = model.actionItems.find((i) => i.id === actionItemId)!
  const m = model.meetingById.get(a.meetingId)!
  const turn = m.transcript?.find((t) => t.id === a.sourceTurnId)
  const theme = model.themes.find((t) => t.id === a.themeId)
  return (
    <motion.div className="pop" role="dialog" aria-label="Action item" style={{ ...place(x, y, Infinity, bodyH, 220), width: CARD_W }} {...pop} onClick={(e) => e.stopPropagation()}>
      <button className="pop-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <div className="pop-title">{a.text}</div>
      <div className="pop-meta pop-tags">
        <span>Action item, {done ? 'on an agenda' : 'not yet committed'}</span>
        {theme && (
          <span className="tag">
            <i style={{ background: themeColor(theme.color) }} />
            {theme.name}
          </span>
        )}
      </div>
      <div className="pop-meta">
        Owner: <PersonLink model={model} id={a.ownerId} onOpen={onOpenPerson} />
      </div>
      {turn && (
        <blockquote>
          <p>“{turn.text}”</p>
          <Cue kind="quote" speaker={speakerName(model, turn.speakerId)} meeting={`${m.title}, ${when(m, model.timeZone)} at ${offset(turn.offsetMs)}`} />
        </blockquote>
      )}
      <div className="pop-actions">
        <button className="link" onClick={() => onOpenMeeting(m.id)}>
          Open {m.title}
        </button>
        <QueueLink id={queued} onShow={onShowInQueue} />
      </div>
    </motion.div>
  )
}

export function MeetingCard(props: {
  model: Model
  meetingId: string
  suggestions: Suggestion[]
  box: Item
  bodyH: number
  stageW: number
  onClose: () => void
  onFocusSuggestion: (id: string) => void
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  onToggleHidden: (meetingId: string) => void
}) {
  const { model, meetingId, suggestions, box, bodyH, stageW, onClose, onFocusSuggestion, onOpenPerson, onOpenMeeting, onToggleHidden } = props
  const m = model.meetingById.get(meetingId)!
  const mine = suggestions.filter((s) => s.targetMeetingId === m.id)
  const accepted = mine.filter((s) => s.status === 'accepted')
  const pending = mine.filter((s) => s.status === 'pending')
  const others = m.attendeeIds.filter((p) => p !== model.leadId)
  const top = box.y + (box.label?.y ?? 0)
  return (
    <motion.div className="pop" role="dialog" aria-label={m.title} style={{ ...place(box.x + box.w, top, stageW, bodyH, 280), width: CARD_W }} {...pop} onClick={(e) => e.stopPropagation()}>
      <button className="pop-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      <div className="pop-title">{m.title}</div>
      <div className="pop-meta pop-tags">
        <span className="tag" data-type={m.type}>
          <i className="type-swatch" />
          {model.typeLabels[m.type]}
        </span>
        <span className="num">{when(m, model.timeZone)}</span>
      </div>
      <div className="pop-meta people-links">
        With{' '}
        {others.map((id, i) => (
          <span key={id}>
            <PersonLink model={model} id={id} onOpen={onOpenPerson} />
            {i < others.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
      <div className="pop-meta tx">
        {m.transcriptHidden ? (
          <Cue kind="hidden" />
        ) : m.transcript ? (
          <span>{m.transcript.length} transcript turns, on this device only</span>
        ) : (
          <span>Not recorded</span>
        )}
        {(m.transcript || m.transcriptHidden) && (
          <button className="link" onClick={() => onToggleHidden(m.id)}>
            {m.transcriptHidden ? 'Show transcript' : 'Hide transcript'}
          </button>
        )}
      </div>
      <div className="pop-actions">
        <button className="btn primary-btn" onClick={() => onOpenMeeting(m.id)}>
          Open meeting
        </button>
      </div>
      <div className="agenda">
        <div className="agenda-head">Agenda</div>
        {m.agenda.length + accepted.length + pending.length === 0 && <div className="agenda-empty">Nothing on the agenda yet.</div>}
        <ul>
          {m.agenda.map((a, i) => (
            <li key={i}>{a.text}</li>
          ))}
          {accepted.map((s) => (
            <li key={s.id} className="from-thread">
              <Icon name="elbow" size={12} />
              <button onClick={() => onFocusSuggestion(s.id)}>{s.text}</button>
              <span className="from">from {s.sources.map((x) => model.meetingById.get(x.meetingId)!.title).join(' and ')}</span>
              <Cue kind="shared" names={names(model, s.visibleTo, 3)} />
            </li>
          ))}
          {pending.map((s) => (
            <li key={s.id} className="pending">
              <button onClick={() => onFocusSuggestion(s.id)}>{s.text}</button>
              <span className="from">
                Suggested, waiting in the action queue · <QueueLink id={s.id} onShow={onFocusSuggestion} />
              </span>
              <Cue kind="shared-on-accept" names={names(model, s.visibleTo, 3)} />
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}

export function PersonLink({ model, id, onOpen }: { model: Model; id: string | null; onOpen: (id: string) => void }) {
  const p = id ? model.people.get(id) : undefined
  if (!p || p.isLead) return <span>{speakerName(model, id)}</span>
  return (
    <button className="link" onClick={() => onOpen(p.id)}>
      {p.name}
    </button>
  )
}
