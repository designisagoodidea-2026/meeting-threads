import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Model, Suggestion } from '../data/types'
import { whySuggested } from '../threads/why'
import { Cue } from './Cue'
import { Icon } from './Icon'
import { names, offset, speakerName, when } from './format'

type Props = {
  model: Model
  suggestions: Suggestion[]
  focusedId: string | null
  onFocus: (id: string) => void
  onAccept: (id: string, text?: string) => void
  onDismiss: (id: string) => void
  onReset: (id: string) => void
  onClose: () => void
}

export function ActionQueue({ model, suggestions, focusedId, onFocus, onAccept, onDismiss, onReset, onClose }: Props) {
  const pending = suggestions.filter((s) => s.status === 'pending' && s.targetMeetingId)
  const orphans = suggestions.filter((s) => s.status === 'pending' && !s.targetMeetingId)
  const accepted = suggestions.filter((s) => s.status === 'accepted')
  const dismissed = suggestions.filter((s) => s.status === 'dismissed')
  const [showDone, setShowDone] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Clicks inside the queue also set focus; only arrivals from elsewhere should scroll and flash.
  const fromHere = useRef(false)
  const focusHere = (id: string) => {
    fromHere.current = true
    onFocus(id)
  }

  // Arriving from anywhere with a suggestion in focus: open its section, scroll to it, and flash it.
  useEffect(() => {
    if (!focusedId) return
    if (fromHere.current) {
      fromHere.current = false
      return
    }
    const s = suggestions.find((x) => x.id === focusedId)
    if (s && s.status !== 'pending') setShowDone(true)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => {
      const box = listRef.current
      const el = box?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(focusedId)}"]`)
      if (box && el) {
        // Glide over short distances; jump over long ones, where a smooth scroll would take seconds.
        const far = Math.abs(el.getBoundingClientRect().top - box.getBoundingClientRect().top) > box.clientHeight * 1.5
        el.scrollIntoView({ block: 'center', behavior: reduced || far ? 'auto' : 'smooth' })
      }
      setFlash(focusedId)
    }, 60) // after the section has rendered and the panel has started opening
    const off = setTimeout(() => setFlash(null), 1700)
    return () => {
      clearTimeout(t)
      clearTimeout(off)
    }
  }, [focusedId]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.aside
      className="queue"
      aria-label="Action queue"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 360, opacity: 1, transition: { type: 'spring', stiffness: 420, damping: 42 } }}
      exit={{ width: 0, opacity: 0, transition: { duration: 0.18 } }}
    >
      <header>
        <h2>Action queue</h2>
        <span className="count">{pending.length} to review</span>
        <button className="pop-close" onClick={onClose} aria-label="Close action queue"><Icon name="close" /></button>
      </header>
      <p className="queue-note">Suggested agenda items, drawn from what was said in earlier meetings. Nothing changes on a meeting until you accept.</p>
      <div className="queue-scroll" ref={listRef}>
      <ul className="queue-list">
        {pending.map((s) => (
          <QueueItem key={s.id} model={model} s={s} focused={focusedId === s.id} flash={flash === s.id} onFocus={focusHere} onAccept={onAccept} onDismiss={onDismiss} />
        ))}
        {orphans.length > 0 && <li className="queue-sub">Needs its own meeting</li>}
        {orphans.map((s) => (
          <QueueItem key={s.id} model={model} s={s} focused={focusedId === s.id} flash={flash === s.id} onFocus={focusHere} onAccept={onAccept} onDismiss={onDismiss} />
        ))}
      </ul>
      <button className="queue-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
        {showDone ? 'Hide' : 'Show'} accepted ({accepted.length}) and dismissed ({dismissed.length})
      </button>
      {showDone && (
        <ul className="queue-list done">
          {[...accepted, ...dismissed].map((s) => (
            <li key={s.id} data-sid={s.id} className={`qi ${s.status}${focusedId === s.id ? ' focused' : ''}${flash === s.id ? ' flash' : ''}`} onClick={() => focusHere(s.id)}>
              <div className="qi-text">{s.text}</div>
              <Route model={model} s={s} />
              <div className="qi-status">{s.status === 'accepted' ? 'On the agenda' : 'Dismissed'}</div>
              <div className="qi-actions">
                <button onClick={(e) => { e.stopPropagation(); onReset(s.id) }}>{s.status === 'accepted' ? 'Undo' : 'Restore'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </motion.aside>
  )
}

function Route({ model, s }: { model: Model; s: Suggestion }) {
  const tz = model.timeZone
  const target = s.targetMeetingId ? model.meetingById.get(s.targetMeetingId)! : null
  return (
    <div className="qi-route">
      <span>
        From {s.sources.map((x) => { const m = model.meetingById.get(x.meetingId)!; return `${m.title} (${when(m, tz)})` }).join(' and ')}
      </span>
      <span>{target ? `To ${target.title} (${when(target, tz)})` : 'Needs its own meeting'}</span>
    </div>
  )
}

function QueueItem(props: {
  model: Model
  s: Suggestion
  focused: boolean
  flash: boolean
  onFocus: (id: string) => void
  onAccept: (id: string, text?: string) => void
  onDismiss: (id: string) => void
}) {
  const { model, s, focused, flash, onFocus, onAccept, onDismiss } = props
  const [draft, setDraft] = useState<string | null>(null)
  const who = names(model, s.visibleTo, 3)
  return (
    <li data-sid={s.id} className={`qi${focused ? ' focused' : ''}${flash ? ' flash' : ''}${s.targetMeetingId ? '' : ' orphan'}`} onClick={() => onFocus(s.id)}>
      {draft === null ? (
        <div className="qi-text">{s.text}</div>
      ) : (
        <textarea
          className="qi-edit"
          value={draft}
          autoFocus
          onFocus={(e) => e.target.select()}
          aria-label="Agenda item text"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <Why model={model} s={s} />
      <Route model={model} s={s} />
      <div className="qi-foot">
        {s.sources.length > 1 && <span className="qi-merged">{s.sources.length} sources</span>}
        {s.targetMeetingId && who.length ? <Cue kind="shared-on-accept" names={who} /> : <Cue kind="private" />}
      </div>
      {s.targetMeetingId && (
        <div className="qi-actions" onClick={(e) => e.stopPropagation()}>
          {draft === null ? (
            <>
              <button className="primary" onClick={() => onAccept(s.id)}>Accept</button>
              <button onClick={() => setDraft(s.text)}>Edit</button>
              <button onClick={() => onDismiss(s.id)}>Dismiss</button>
            </>
          ) : (
            <>
              <button className="primary" disabled={!draft.trim()} onClick={() => onAccept(s.id, draft.trim())}>Accept edited</button>
              <button onClick={() => setDraft(null)}>Cancel</button>
            </>
          )}
        </div>
      )}
      {!s.targetMeetingId && (
        <div className="qi-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onDismiss(s.id)}>Dismiss</button>
        </div>
      )}
    </li>
  )
}

// What prompted the suggestion and why it points where it does (spec 006 FR-027).
function Why({ model, s }: { model: Model; s: Suggestion }) {
  const w = whySuggested(model, s)
  return (
    <div className="qi-why">
      {w.quotes.map(({ meetingId, turn }) => (
        <blockquote key={turn.id}>
          <p>“{turn.text}”</p>
          <Cue kind="quote" speaker={speakerName(model, turn.speakerId)} meeting={`${model.meetingById.get(meetingId)!.title} at ${offset(turn.offsetMs)}`} />
        </blockquote>
      ))}
      <p className="qi-reason">{w.reason}</p>
    </div>
  )
}
