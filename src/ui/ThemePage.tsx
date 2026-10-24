import { useMemo } from 'react'
import type { Model, Suggestion } from '../data/types'
import { themeSummary } from '../threads/theme'
import { itemCommitments } from '../threads/threads'
import { Cue } from './Cue'
import { DetailShell } from './DetailShell'
import { names, offset, speakerName, when } from './format'
import { Icon } from './Icon'
import { QueueLink } from './QueueLink'
import { themeColor } from './theme-colors'

const GAP_TEXT = { hidden: 'Transcript hidden', 'not-recorded': 'Not recorded', 'no-mention': 'On the theme, but nothing said about it on record' }

type Props = {
  model: Model
  themeId: string
  suggestions: Suggestion[]
  doneItems: Set<string>
  fromPage: boolean
  onClose: () => void
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  onShowInQueue: (suggestionId: string) => void
}

// A theme's full record (spec 006 US3): where it came up, who carried it, what was said, and what it
// has produced so far.
export function ThemePage({ model, themeId, suggestions, doneItems, fromPage, onClose, onOpenPerson, onOpenMeeting, onShowInQueue }: Props) {
  const s = useMemo(() => themeSummary(model, themeId, suggestions, doneItems), [model, themeId, suggestions, doneItems])
  const commits = useMemo(() => itemCommitments(model, suggestions), [model, suggestions])
  const tz = model.timeZone
  const color = themeColor(s.theme.color)
  const mentionCount = s.mentions.reduce((n, x) => n + x.turns.length, 0)
  const top = Math.max(1, ...s.contributors.map((c) => c.count))
  const person = (id: string | null) =>
    id && id !== model.leadId && model.people.has(id) ? (
      <button className="link" onClick={() => onOpenPerson(id)}>{speakerName(model, id)}</button>
    ) : (
      <span>{id === model.leadId ? `${speakerName(model, id)} (you)` : speakerName(model, id)}</span>
    )
  const meetingLink = (id: string) => {
    const m = model.meetingById.get(id)!
    return (
      <button className="link" onClick={() => onOpenMeeting(id)}>
        {m.title}
      </button>
    )
  }

  return (
    <DetailShell model={model} label={s.theme.name} className="page theme-page" fromPage={fromPage} onClose={onClose}>
      {({ chip, leave }) => (
        <>
          <header className="page-head" style={{ ['--theme' as string]: color }}>
            <button className="back" onClick={leave}>
              <Icon name="back" /> Calendar
            </button>
            <span className="theme-mark" aria-hidden="true" />
            <div className="page-title">
              <h2>{s.theme.name}</h2>
              <div className="page-sub num">
                <span>{s.meetings.length} {s.meetings.length === 1 ? 'meeting' : 'meetings'}</span>
                <span>{s.contributors.length} {s.contributors.length === 1 ? 'voice' : 'voices'}</span>
                <span>{mentionCount} {mentionCount === 1 ? 'mention' : 'mentions'}</span>
                <span>{s.actionItems.length} action {s.actionItems.length === 1 ? 'item' : 'items'}</span>
              </div>
            </div>
          </header>

          <section className="page-main" aria-label="What was said">
            <h3>What was said, meeting by meeting</h3>
            {s.meetings.length === 1 && <p className="muted">No other meeting has picked this theme up yet.</p>}
            <ol className="mention-list" style={{ ['--theme' as string]: color }}>
              {s.mentions.map((row) => {
                const m = model.meetingById.get(row.meetingId)!
                return (
                  <li key={row.meetingId}>
                    <div className="mention-head">
                      <span className="tl-chip" data-type={m.type} {...chip(m.id)} />
                      <div>
                        {meetingLink(m.id)}
                        <div className="mention-sub">
                          <span className="num">{when(m, tz)}</span> · {model.typeLabels[m.type]}
                        </div>
                      </div>
                    </div>
                    {row.turns.length ? (
                      <div className="mention-turns">
                        {row.turns.map((t) => (
                          <blockquote key={t.id}>
                            <p>“{t.text}”</p>
                            <Cue kind="quote" speaker={speakerName(model, t.speakerId)} meeting={`at ${offset(t.offsetMs)}`} />
                          </blockquote>
                        ))}
                      </div>
                    ) : row.gap === 'hidden' ? (
                      <div className="mention-turns">
                        <Cue kind="hidden" />
                      </div>
                    ) : (
                      <p className="mention-turns muted">{GAP_TEXT[row.gap!]}</p>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>

          <aside className="page-side">
            <section className="panel">
              <h3>Who carried it</h3>
              {s.contributors.length === 0 && <p className="muted">Nobody on record.</p>}
              <ul className="bars">
                {s.contributors.map((c) => (
                  <li key={c.personId ?? 'unknown'}>
                    <span className="bar-name">{person(c.personId)}</span>
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${(c.count / top) * 100}%`, background: color }} />
                    </span>
                    <span className="bar-count num" aria-label={`${c.count} mentions`}>
                      {c.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>Action items on this theme</h3>
              {s.actionItems.length === 0 && <p className="muted">None.</p>}
              <ul className="item-list">
                {s.actionItems.map(({ item, status }) => {
                  const c = commits.get(item.id)!
                  return (
                    <li key={item.id}>
                      <span className="item-text">{item.text}</span>
                      <span className="item-meta">
                        {person(item.ownerId)} · from {meetingLink(item.meetingId)} ·{' '}
                        {status === 'on-agenda' && c.committed ? <>on the agenda for {meetingLink(c.committed)}</> : <span className="muted">not yet committed</span>}
                        {c.suggestionId && <> · <QueueLink id={c.suggestionId} onShow={onShowInQueue} /></>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="panel">
              <h3>On agendas</h3>
              {s.suggestions.accepted.length === 0 && <p className="muted">Nothing accepted yet.</p>}
              <ul className="item-list">
                {s.suggestions.accepted.map((x) => (
                  <li key={x.id}>
                    <span className="item-text">{x.text}</span>
                    <span className="item-meta">
                      For {meetingLink(x.targetMeetingId!)} · <QueueLink id={x.id} onShow={onShowInQueue} />
                    </span>
                    <Cue kind="shared" names={names(model, x.visibleTo, 3)} />
                  </li>
                ))}
              </ul>
              <h3 className="sub-head">Suggested, waiting in the queue</h3>
              {s.suggestions.pending.length === 0 && <p className="muted">None.</p>}
              <ul className="item-list">
                {s.suggestions.pending.map((x) => (
                  <li key={x.id}>
                    <span className="item-text pending-text">{x.text}</span>
                    <span className="item-meta">
                      {x.targetMeetingId ? <>For {meetingLink(x.targetMeetingId)}</> : 'Needs its own meeting'} ·{' '}
                      <QueueLink id={x.id} onShow={onShowInQueue} />
                    </span>
                    {x.targetMeetingId && x.visibleTo.length > 0 && <Cue kind="shared-on-accept" names={names(model, x.visibleTo, 3)} />}
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
