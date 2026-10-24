import { useMemo, useState } from 'react'
import type { Model, RelationshipNote, Suggestion } from '../data/types'
import { personSummary } from '../threads/person'
import { Cue } from './Cue'
import { offset, speakerName, when } from './format'
import { DetailShell } from './DetailShell'
import { Icon } from './Icon'
import { QueueLink } from './QueueLink'
import { itemCommitments } from '../threads/threads'
import { themeColor } from './theme-colors'

type Props = {
  model: Model
  personId: string
  doneItems: Set<string>
  notes: RelationshipNote[]
  onSaveNote: (note: RelationshipNote) => void
  onDeleteNote: (id: string) => void
  fromPage: boolean
  onClose: () => void
  onOpenMeeting: (id: string) => void
  onOpenTheme: (id: string) => void
  suggestions: Suggestion[]
  onShowInQueue: (suggestionId: string) => void
}

export function PersonPage({ model, personId, doneItems, notes, onSaveNote, onDeleteNote, fromPage, onClose, onOpenMeeting, onOpenTheme, suggestions, onShowInQueue }: Props) {
  const person = model.people.get(personId)!
  const summary = useMemo(() => personSummary(model, personId, doneItems), [model, personId, doneItems])
  const [open, setOpen] = useState<string | null>(null)
  const commits = useMemo(() => itemCommitments(model, suggestions), [model, suggestions])

  const tz = model.timeZone
  const mine = notes.filter((n) => n.personId === personId)
  const nextTitle = (id: string | null) => {
    if (!id) return 'None scheduled'
    const m = model.meetingById.get(id)!
    return `${m.title}, ${when(m, tz)}`
  }

  return (
    <DetailShell model={model} label={person.name} className="person" fromPage={fromPage} onClose={onClose}>
      {({ chip, leave }) => (
      <>
        <header className="person-head">
          <button className="back" onClick={leave}>
            <Icon name="back" /> Calendar
          </button>
          <div>
            <h2>{person.name}</h2>
            <div className="person-role">{person.role}</div>
          </div>
          <div className="person-stats">
            {summary.meetings.length} meetings together in these two weeks · {summary.open.length} open threads
          </div>
        </header>

        <div className="person-timeline">
          <h3>Meetings together</h3>
          <ol>
            {summary.meetings.map(({ meeting, turns }) => {
              const expanded = open === meeting.id
              return (
                <li key={meeting.id} className={expanded ? 'expanded' : ''}>
                  <button className="tl-row" onClick={() => setOpen(expanded ? null : meeting.id)} aria-expanded={expanded}>
                    <span className="tl-chip" data-type={meeting.type} {...chip(meeting.id)} />
                    <span className="tl-when">{when(meeting, tz)}</span>
                    <span className="tl-title">{meeting.title}</span>
                    <span className="tl-meta">
                      {model.typeLabels[meeting.type]}
                      {meeting.transcriptHidden
                        ? ' · transcript hidden'
                        : !meeting.transcript
                          ? ' · not recorded'
                          : turns.length
                            ? ` · ${turns.length} ${turns.length === 1 ? 'thing' : 'things'} said by you two`
                            : ' · nothing from you two on record'}
                    </span>
                  </button>
                  {expanded && (
                    <div className="tl-turns">
                      <button className="link tl-open" onClick={() => onOpenMeeting(meeting.id)}>
                        Open {meeting.title}
                      </button>
                      {meeting.transcriptHidden && <Cue kind="hidden" />}
                      {!meeting.transcriptHidden && turns.length === 0 && <p className="muted">Nothing on record from either of you.</p>}
                      {turns.map((t) => (
                        <blockquote key={t.id} className={t.speakerId === personId ? 'them' : 'you'}>
                          <p>“{t.text}”</p>
                          <Cue kind="quote" speaker={speakerName(model, t.speakerId)} meeting={`${meeting.title} at ${offset(t.offsetMs)}`} />
                        </blockquote>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>

        <div className="person-side">
          <section className="panel">
            <h3>Open threads</h3>
            {summary.open.length === 0 && <p className="muted">Nothing open.</p>}
            <ul className="open-list">
              {summary.open.map((o) => {
                const theme = o.kind === 'theme' ? model.themes.find((t) => t.id === o.id) : undefined
                return (
                  <li key={`${o.kind}:${o.id}`}>
                    <span className="open-kind">
                      {theme && <i style={{ background: themeColor(theme.color) }} />}
                      {o.kind === 'action' ? 'Action item' : 'Theme'}
                    </span>
                    {o.kind === 'theme' ? (
                      <button className="link open-label" onClick={() => onOpenTheme(o.id)}>
                        {o.label}
                      </button>
                    ) : (
                      <span className="open-label">{o.label}</span>
                    )}
                    <span className="open-next">
                      Next: {nextTitle(o.nextMeetingId)}
                      {o.kind === 'action' && commits.get(o.id)?.suggestionId && (
                        <> · <QueueLink id={commits.get(o.id)!.suggestionId} onShow={onShowInQueue} /></>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
          <Notes personId={personId} notes={mine} onSave={onSaveNote} onDelete={onDeleteNote} />
        </div>
      </>
      )}
    </DetailShell>
  )
}

function Notes(props: { personId: string; notes: RelationshipNote[]; onSave: (n: RelationshipNote) => void; onDelete: (id: string) => void }) {
  const { personId, notes, onSave, onDelete } = props
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const now = () => new Date().toISOString()
  return (
    <section className="panel">
      <h3>
        Your notes <Cue kind="private" />
      </h3>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id}>
            {editing === n.id ? (
              <>
                <textarea aria-label="Edit note" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
                <div className="note-actions">
                  <button className="primary" disabled={!editText.trim()} onClick={() => { onSave({ ...n, text: editText.trim(), updatedAt: now() }); setEditing(null) }}>Save</button>
                  <button onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p>{n.text}</p>
                <div className="note-actions">
                  <button onClick={() => { setEditing(n.id); setEditText(n.text) }}>Edit</button>
                  <button onClick={() => onDelete(n.id)}>Delete</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <textarea
        className="note-new"
        aria-label="New note"
        placeholder="What do they care about, how do they like to work, what did you promise?"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="note-actions">
        <button
          className="primary"
          disabled={!draft.trim()}
          onClick={() => {
            onSave({ id: `n_${Date.now().toString(36)}`, personId, text: draft.trim(), updatedAt: now() })
            setDraft('')
          }}
        >
          Add note
        </button>
      </div>
    </section>
  )
}
