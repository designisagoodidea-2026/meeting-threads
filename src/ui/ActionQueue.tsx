import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Model, Suggestion } from '../data/types'
import { groupQueue, step } from '../threads/queue'
import { whySuggested } from '../threads/why'
import { Cue } from './Cue'
import { Icon } from './Icon'
import { names, offset, speakerName, when } from './format'

type Props = {
  model: Model
  suggestions: Suggestion[]
  focusedId: string | null
  onFocus: (id: string | null) => void // null = nothing selected
  onAccept: (id: string, text?: string) => void
  onDismiss: (id: string) => void
  onReset: (id: string) => void
  onUndoLast: () => void
  keysActive: boolean // false while a page, panel or the tour is up, so keys never act on a queue you can't see
  onClose: () => void
}

export function ActionQueue({ model, suggestions, focusedId, onFocus, onAccept, onDismiss, onReset, onUndoLast, keysActive, onClose }: Props) {
  // Grouped by the meeting each item lands on (FR-030). Accepted items stay in place, showing the
  // change, so the result and its undo are in view (FR-029).
  const pending = suggestions.filter((s) => s.status === 'pending' && s.targetMeetingId)
  const groups = groupQueue(model, suggestions)
  const order = groups.flatMap((g) => g.items.map((s) => s.id))
  const accepted = suggestions.filter((s) => s.status === 'accepted')
  const dismissed = suggestions.filter((s) => s.status === 'dismissed')
  const [showDone, setShowDone] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Clicks inside the queue also set focus; only arrivals from elsewhere should scroll and flash.
  const fromHere = useRef(false)
  const fromKeys = useRef(false)
  // Clicking the selected item again lets go of it, as with meeting blocks.
  const focusHere = (id: string) => {
    fromHere.current = true
    onFocus(id === focusedId ? null : id)
  }

  // Arriving from anywhere with a suggestion in focus: open its section, scroll to it, and flash it.
  useEffect(() => {
    if (!focusedId) return
    if (fromKeys.current) {
      fromKeys.current = false
      // Move real focus too, so a screen reader announces the item (it carries aria-current).
      const el = listRef.current?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(focusedId)}"]`)
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (fromHere.current) {
      fromHere.current = false
      return
    }
    const s = suggestions.find((x) => x.id === focusedId)
    if (s && s.status === 'dismissed') setShowDone(true)
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
  // Keyboard triage (FR-030): J/K move, A adds to the agenda, D dismisses (both move on), U undoes the last decision.
  const keys = useRef({ order, focusedId, suggestions, onAccept, onDismiss, onUndoLast, onFocus, keysActive })
  keys.current = { order, focusedId, suggestions, onAccept, onDismiss, onUndoLast, onFocus, keysActive }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      const elsewhere = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      if (!k.keysActive || e.metaKey || e.ctrlKey || e.altKey || elsewhere) return
      const cur = k.suggestions.find((s) => s.id === k.focusedId)
      const go = (id: string | null) => {
        if (!id || id === k.focusedId) return // nothing moves, so no focus effect runs to clear the flag
        fromKeys.current = true
        k.onFocus(id)
      }
      const key = e.key.toLowerCase()
      if (key === 'j' || key === 'k') go(step(k.order, cur ? cur.id : null, key === 'j' ? 1 : -1))
      else if (key === 'a' && cur?.status === 'pending' && cur.targetMeetingId) {
        k.onAccept(cur.id)
        go(step(k.order, cur.id, 1))
      } else if (key === 'd' && cur?.status === 'pending') {
        const next = step(k.order, cur.id, 1)
        k.onDismiss(cur.id)
        go(next !== cur.id ? next : step(k.order, cur.id, -1))
      } else if (key === 'u') k.onUndoLast()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
        <span className="count">{pending.length} to review{accepted.length > 0 && ` · ${accepted.length} on agendas`}</span>
        <button className="pop-close" onClick={onClose} aria-label="Close action queue"><Icon name="close" /></button>
      </header>
      <p className="queue-note">
        Suggested agenda items, drawn from what was said in earlier meetings, grouped by the meeting they'd go to. Nothing changes on a meeting until you add it.
        <span className="queue-keys"><kbd>J</kbd><kbd>K</kbd> move · <kbd>A</kbd> add · <kbd>D</kbd> dismiss · <kbd>U</kbd> undo</span>
      </p>
      <div className="queue-scroll" ref={listRef}>
      {groups.map((g) => {
        const m = g.meetingId ? model.meetingById.get(g.meetingId)! : null
        return (
          <section key={g.meetingId ?? 'none'} className="queue-group" aria-label={m ? `For ${m.title}` : 'Needs its own meeting'}>
            <h3 className="queue-sub">
              <span>{m ? m.title : 'Needs its own meeting'}</span>
              {m && <span className="when">{when(m, model.timeZone)}</span>}
              <span className="n">{g.toReview > 0 ? `${g.toReview} to review` : 'done'}</span>
            </h3>
            <ul className="queue-list">
              {g.items.map((s) =>
                s.status === 'accepted' ? (
                  <AcceptedItem key={s.id} model={model} s={s} focused={focusedId === s.id} flash={flash === s.id} onFocus={focusHere} onUndo={onReset} />
                ) : (
                  <QueueItem key={s.id} model={model} s={s} focused={focusedId === s.id} flash={flash === s.id} onFocus={focusHere} onAccept={onAccept} onDismiss={onDismiss} />
                ),
              )}
            </ul>
          </section>
        )
      })}
      {dismissed.length > 0 && (
        <button className="queue-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
          {showDone ? 'Hide' : 'Show'} dismissed ({dismissed.length})
        </button>
      )}
      {showDone && dismissed.length > 0 && (
        <ul className="queue-list done">
          {dismissed.map((s) => (
            <li key={s.id} data-sid={s.id} className={`qi ${s.status}${focusedId === s.id ? ' focused' : ''}${flash === s.id ? ' flash' : ''}`} onClick={() => focusHere(s.id)}>
              <div className="qi-text">{s.text}</div>
              <Route model={model} s={s} />
              <div className="qi-status">Dismissed</div>
              <div className="qi-actions">
                <button onClick={(e) => { e.stopPropagation(); onReset(s.id) }}>Restore</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </motion.aside>
  )
}

function Route({ model, s, from = false }: { model: Model; s: Suggestion; from?: boolean }) {
  const tz = model.timeZone
  const target = s.targetMeetingId ? model.meetingById.get(s.targetMeetingId)! : null
  return (
    <div className="qi-route">
      <span>
        From {s.sources.map((x) => { const m = model.meetingById.get(x.meetingId)!; return `${m.title} (${when(m, tz)})` }).join(' and ')}
      </span>
      {!from && <span>{target ? `To ${target.title} (${when(target, tz)})` : 'Needs its own meeting'}</span>}
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
  const target = s.targetMeetingId ? model.meetingById.get(s.targetMeetingId)! : null
  const edit = (
        <textarea
          className="qi-edit"
          value={draft ?? ''}
          autoFocus
          onFocus={(e) => e.target.select()}
          aria-label="Agenda item text"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
        />
  )
  return (
    <li data-sid={s.id} className={`qi${focused ? ' focused' : ''}${flash ? ' flash' : ''}${s.targetMeetingId ? '' : ' orphan'}`} tabIndex={-1} aria-current={focused || undefined} onClick={() => onFocus(s.id)}>
      {target ? (
        // What adding it does, before you do it (FR-042): the exact line, on which agenda, and who sees it.
        <div className="qi-preview" aria-label={`Preview: adds this line to the ${target.title} agenda`}>
          <div className="qi-preview-head">Adds this line to the agenda</div>
          {draft === null ? (
            <div className="qi-line">
              <span className="qi-bullet" aria-hidden="true">•</span>
              <span>{s.text}</span>
            </div>
          ) : (
            edit
          )}
          {who.length ? <Cue kind="shared-on-accept" names={who} /> : <Cue kind="private" />}
        </div>
      ) : draft === null ? (
        <div className="qi-text">{s.text}</div>
      ) : (
        edit
      )}
      <Why model={model} s={s} brief={!focused} />
      <Route model={model} s={s} from />
      {(s.sources.length > 1 || !target) && (
        <div className="qi-foot">
          {s.sources.length > 1 && <span className="qi-merged">{s.sources.length} sources</span>}
          {!target && <Cue kind="private" />}
        </div>
      )}
      {s.targetMeetingId && (
        <div className="qi-actions" onClick={(e) => e.stopPropagation()}>
          {draft === null ? (
            <>
              <button className="primary add" onClick={() => onAccept(s.id)} title={`Add to the ${target!.title} agenda, ${when(target!, model.timeZone)}`}>
                Add to {target!.title}
              </button>
              <button onClick={() => setDraft(s.text)}>Edit</button>
              <button onClick={() => onDismiss(s.id)}>Dismiss</button>
            </>
          ) : (
            <>
              <button className="primary" disabled={!draft.trim()} onClick={() => onAccept(s.id, draft.trim())}>Add edited line</button>
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

// An accepted item, in place: what changed on which agenda, who can now see it, and the quote behind it.
function AcceptedItem(props: { model: Model; s: Suggestion; focused: boolean; flash: boolean; onFocus: (id: string) => void; onUndo: (id: string) => void }) {
  const { model, s, focused, flash, onFocus, onUndo } = props
  const target = model.meetingById.get(s.targetMeetingId!)!
  const turns = new Set(s.sources.map((x) => x.turnId))
  const item = model.actionItems.find((a) => turns.has(a.sourceTurnId))
  return (
    <li data-sid={s.id} className={`qi accepted${focused ? ' focused' : ''}${flash ? ' flash' : ''}`} tabIndex={-1} aria-current={focused || undefined} onClick={() => onFocus(s.id)}>
      <div className="qi-done-head">
        <Icon name="check" size={13} />
        Added to {target.title}, {when(target, model.timeZone)}
      </div>
      <div className="qi-change" aria-label="Agenda change">
        <span className="qi-plus" aria-hidden="true">+</span>
        {s.text}
      </div>
      <Why model={model} s={s} brief={!focused} />
      <ul className="qi-effects">
        {item && <li>Action item for {item.ownerId === model.leadId ? 'you' : speakerName(model, item.ownerId)} now committed to this meeting</li>}
        <li><Cue kind="shared" names={names(model, s.visibleTo, 3)} /></li>
      </ul>
      <div className="qi-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onUndo(s.id)}>Undo</button>
      </div>
    </li>
  )
}

// What prompted the suggestion and why it points where it does (spec 006 FR-027).
// Brief (unfocused): one line naming who said it, so a long queue scans quickly.
function Why({ model, s, brief = false }: { model: Model; s: Suggestion; brief?: boolean }) {
  const w0 = whySuggested(model, s)
  // A theme follow-up's line already quotes its speaker (FR-042); don't show the same words twice.
  const inLine = (t: string) => s.text.includes(t.slice(0, 40))
  const w = { ...w0, quotes: w0.quotes.filter((q) => !inLine(q.turn.text)) }
  if (brief) {
    const q = w.quotes[0]
    if (!q && w0.quotes.length) return null // the line above already shows who said what
    return q ? (
      <p className="qi-brief">
        <b>{speakerName(model, q.turn.speakerId)}:</b> “{q.turn.text}”
      </p>
    ) : null
  }
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
