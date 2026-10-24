import { useMemo } from 'react'
import type { Model, Suggestion } from '../data/types'
import { TYPE_LABELS } from '../layout/layouts'
import { meetingSummary } from '../threads/meeting'
import { itemCommitments } from '../threads/threads'
import { Cue } from './Cue'
import { DetailShell } from './DetailShell'
import { hm, names, offset, speakerName, when } from './format'
import { Icon } from './Icon'
import { QueueLink } from './QueueLink'
import { themeColor } from './theme-colors'

type Props = {
  model: Model
  meetingId: string
  suggestions: Suggestion[]
  doneItems: Set<string>
  fromPage: boolean
  onClose: () => void
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  onOpenTheme: (id: string) => void
  onToggleHidden: (id: string) => void
  onShowInQueue: (suggestionId: string) => void
}

// A meeting's full record (spec 006 US2): who, what was on the agenda and what joined it, what was
// said, which threads run through it and where they go next, and what was committed.
export function MeetingPage(props: Props) {
  const { model, meetingId, suggestions, doneItems, fromPage, onClose, onOpenPerson, onOpenMeeting, onOpenTheme, onToggleHidden, onShowInQueue } = props
  const s = useMemo(() => meetingSummary(model, meetingId, suggestions, doneItems), [model, meetingId, suggestions, doneItems])
  const commits = useMemo(() => itemCommitments(model, suggestions), [model, suggestions])
  const m = s.meeting
  const tz = model.timeZone
  const minutes = Math.round((+m.end - +m.start) / 60000)
  const theme = (id: string) => model.themes.find((t) => t.id === id)!
  const meetingLink = (id: string | null, fallback: string) => {
    if (!id) return <span className="muted">{fallback}</span>
    const x = model.meetingById.get(id)!
    return (
      <button className="link" onClick={() => onOpenMeeting(id)}>
        {x.title}, <span className="num">{when(x, tz)}</span>
      </button>
    )
  }
  const person = (id: string | null) =>
    id && id !== model.leadId && model.people.has(id) ? (
      <button className="link" onClick={() => onOpenPerson(id)}>{speakerName(model, id)}</button>
    ) : (
      <span>{id === model.leadId ? `${speakerName(model, id)} (you)` : speakerName(model, id)}</span>
    )

  return (
    <DetailShell model={model} label={m.title} className="page meeting-page" fromPage={fromPage} onClose={onClose}>
      {({ chip, leave }) => (
        <>
          <header className="page-head">
            <button className="back" onClick={leave}>
              <Icon name="back" /> Calendar
            </button>
            <span className="head-chip" data-type={m.type} {...chip(m.id)} />
            <div className="page-title">
              <h2>{m.title}</h2>
              <div className="page-sub">
                <span className="tag" data-type={m.type}>
                  <i className="type-swatch" />
                  {TYPE_LABELS[m.type]}
                </span>
                <span className="num">
                  {when(m, tz)}–{hm(m.end, tz)} · {minutes} min
                </span>
                <span className="num">{s.attendees.length} people</span>
              </div>
            </div>
          </header>

          <section className="page-main" aria-label="Transcript">
            <h3>Transcript</h3>
            {s.transcript ? (
              <ol className="transcript">
                {s.transcript.map(({ turn, themeIds }) => (
                  <li key={turn.id} className={turn.speakerId === model.leadId ? 'you' : ''}>
                    <div className="turn-meta">
                      {person(turn.speakerId)}
                      <span className="num">{offset(turn.offsetMs)}</span>
                    </div>
                    <p>{turn.text}</p>
                    <div className="turn-foot">
                      <Cue kind="quote" speaker={speakerName(model, turn.speakerId)} meeting={`${m.title} at ${offset(turn.offsetMs)}`} />
                      {themeIds.map((id) => (
                        <button key={id} className="theme-chip" onClick={() => onOpenTheme(id)}>
                          <i style={{ background: themeColor(theme(id).color) }} />
                          {theme(id).name}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            ) : s.gap === 'hidden' ? (
              <div className="gap-note">
                <Cue kind="hidden" />
                <button className="link" onClick={() => onToggleHidden(m.id)}>Show transcript</button>
              </div>
            ) : (
              <p className="gap-note muted">Not recorded.</p>
            )}
          </section>

          <aside className="page-side">
            <section className="panel">
              <h3>Agenda</h3>
              {s.agenda.seeded.length + s.agenda.accepted.length + s.agenda.pending.length === 0 && <p className="muted">Nothing on the agenda yet.</p>}
              <ul className="agenda-list">
                {s.agenda.seeded.map((a, i) => (
                  <li key={i}>{a.text}</li>
                ))}
                {s.agenda.accepted.map((a) => (
                  <li key={a.id} className="from-thread">
                    <Icon name="elbow" size={12} />
                    <div>
                      {a.text}
                      <span className="from">
                        From {a.sources.map((x) => model.meetingById.get(x.meetingId)!.title).join(' and ')} · <QueueLink id={a.id} onShow={onShowInQueue} />
                      </span>
                      <Cue kind="shared" names={names(model, a.visibleTo, 3)} />
                    </div>
                  </li>
                ))}
                {s.agenda.pending.map((a) => (
                  <li key={a.id} className="pending">
                    <div>
                      <span className="pending-text">{a.text}</span>
                      <span className="from">
                        Suggested, waiting in the action queue · <QueueLink id={a.id} onShow={onShowInQueue} />
                      </span>
                      <Cue kind="shared-on-accept" names={names(model, a.visibleTo, 3)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>Threads through this meeting</h3>
              {s.themes.length === 0 && <p className="muted">No themes.</p>}
              <ul className="thread-list">
                {s.themes.map((t) => (
                  <li key={t.themeId}>
                    <button className="theme-chip" onClick={() => onOpenTheme(t.themeId)}>
                      <i style={{ background: themeColor(theme(t.themeId).color) }} />
                      {theme(t.themeId).name}
                    </button>
                    <div className="neighbours">
                      <span className="nb-label">Before</span>
                      {meetingLink(t.prevMeetingId, 'First on this theme')}
                      <span className="nb-label">After</span>
                      {meetingLink(t.nextMeetingId, 'Last on this theme so far')}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>Action items raised here</h3>
              {s.actionItems.length === 0 && <p className="muted">{s.gap === 'hidden' ? 'Hidden with the transcript.' : 'None.'}</p>}
              <ul className="item-list">
                {s.actionItems.map(({ item, status }) => {
                  const c = commits.get(item.id)!
                  return (
                    <li key={item.id}>
                      <span className="item-text">{item.text}</span>
                      <span className="item-meta">
                        {person(item.ownerId)} ·{' '}
                        {status === 'on-agenda' && c.committed ? (
                          <>On the agenda for {meetingLink(c.committed, '')}</>
                        ) : (
                          <span className="muted">Not yet committed</span>
                        )}
                        {c.suggestionId && <> · <QueueLink id={c.suggestionId} onShow={onShowInQueue} /></>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="panel">
              <h3>People</h3>
              <ul className="people-list">
                {s.attendees.map((id) => (
                  <li key={id}>
                    {person(id)}
                    <span className="muted">{model.people.get(id)?.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </>
      )}
    </DetailShell>
  )
}
