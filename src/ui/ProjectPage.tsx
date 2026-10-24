import { useMemo } from 'react'
import type { Meeting, Model, Suggestion } from '../data/types'
import { projectSummary } from '../threads/project'
import { itemCommitments } from '../threads/threads'
import { Cue } from './Cue'
import { DetailShell, type ShellApi } from './DetailShell'
import { names, speakerName, when } from './format'
import { Icon } from './Icon'
import { QueueLink } from './QueueLink'
import { themeColor } from './theme-colors'

type Props = {
  model: Model
  projectId: string
  suggestions: Suggestion[]
  doneItems: Set<string>
  fromPage: boolean
  onClose: () => void
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  onOpenTheme: (id: string) => void
  onShowInQueue: (suggestionId: string) => void
}

// A project's record (spec 006 FR-039): its meetings, already held and coming up, the themes that run
// through it, who's in the room, and what it has produced.
export function ProjectPage({ model, projectId, suggestions, doneItems, fromPage, onClose, onOpenPerson, onOpenMeeting, onOpenTheme, onShowInQueue }: Props) {
  const s = useMemo(() => projectSummary(model, projectId, suggestions, doneItems), [model, projectId, suggestions, doneItems])
  const commits = useMemo(() => itemCommitments(model, suggestions), [model, suggestions])
  const tz = model.timeZone
  const top = Math.max(1, ...s.people.map((p) => p.count))
  const held = s.meetings.filter((m) => !m.upcoming)
  const ahead = s.meetings.filter((m) => m.upcoming)
  const meetingLink = (id: string) => (
    <button className="link" onClick={() => onOpenMeeting(id)}>
      {model.meetingById.get(id)!.title}
    </button>
  )
  const themeChip = (id: string) => {
    const t = model.themes.find((x) => x.id === id)!
    return (
      <button key={id} className="theme-chip" onClick={() => onOpenTheme(id)}>
        <i style={{ background: themeColor(t.color) }} />
        {t.name}
      </button>
    )
  }
  const list = (ms: Meeting[], chip: ShellApi['chip']) => (
    <ol className="mention-list">
      {ms.map((m) => (
        <li key={m.id}>
          <div className="mention-head">
            <span className="tl-chip" data-type={m.type} {...chip(m.id)} />
            <div>
              {meetingLink(m.id)}
              <div className="mention-sub">
                <span className="num">{when(m, tz)}</span> · {model.typeLabels[m.type]}
              </div>
            </div>
          </div>
          <div className="mention-turns chip-row">{m.themeIds.filter((t) => s.project.themeIds.includes(t)).map(themeChip)}</div>
        </li>
      ))}
    </ol>
  )

  return (
    <DetailShell model={model} label={s.project.name} className="page project-page" fromPage={fromPage} onClose={onClose}>
      {({ chip, leave }) => (
        <>
          <header className="page-head">
            <button className="back" onClick={leave}>
              <Icon name="back" /> Calendar
            </button>
            <div className="page-title">
              <h2>{s.project.name}</h2>
              <div className="page-sub num">
                <span>{s.meetings.length} {s.meetings.length === 1 ? 'meeting' : 'meetings'}</span>
                <span>{s.themes.length} {s.themes.length === 1 ? 'theme' : 'themes'}</span>
                <span>{s.people.length} {s.people.length === 1 ? 'person' : 'people'}</span>
                <span>{s.actionItems.length} action {s.actionItems.length === 1 ? 'item' : 'items'}</span>
              </div>
            </div>
          </header>

          <section className="page-main" aria-label="Meetings">
            <h3>Already happened</h3>
            {held.length ? list(held, chip) : <p className="muted">Nothing yet.</p>}
            <h3 className="sub-head">Coming up</h3>
            {ahead.length ? list(ahead, chip) : <p className="muted">Nothing scheduled.</p>}
          </section>

          <aside className="page-side">
            <section className="panel">
              <h3>Themes running through it</h3>
              <ul className="item-list">
                {s.themes.map((t) => (
                  <li key={t.id}>
                    {themeChip(t.id)}
                    <span className="item-meta num">{t.meetingIds.length} {t.meetingIds.length === 1 ? 'meeting' : 'meetings'} in all, {t.projectIds.length > 1 ? `shared with ${t.projectIds.length - 1} other ${t.projectIds.length === 2 ? 'project' : 'projects'}` : 'only here'}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>Who's in the room</h3>
              <ul className="bars">
                {s.people.map((p) => (
                  <li key={p.personId}>
                    <span className="bar-name">
                      <button className="link" onClick={() => onOpenPerson(p.personId)}>{speakerName(model, p.personId)}</button>
                    </span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${(p.count / top) * 100}%` }} /></span>
                    <span className="bar-count num" aria-label={`${p.count} meetings`}>{p.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>Action items</h3>
              {s.actionItems.length === 0 && <p className="muted">None on record yet.</p>}
              <ul className="item-list">
                {s.actionItems.map(({ item, status }) => {
                  const c = commits.get(item.id)!
                  return (
                    <li key={item.id}>
                      <span className="item-text">{item.text}</span>
                      <span className="item-meta">
                        {speakerName(model, item.ownerId)} · from {meetingLink(item.meetingId)} ·{' '}
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
                    <span className="item-meta">For {meetingLink(x.targetMeetingId!)} · <QueueLink id={x.id} onShow={onShowInQueue} /></span>
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
                      {x.targetMeetingId ? <>For {meetingLink(x.targetMeetingId)}</> : 'Needs its own meeting'} · <QueueLink id={x.id} onShow={onShowInQueue} />
                    </span>
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
