import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { DataError, loadModel } from './data/load'
import { applyPrivacy } from './data/privacy'
import type { Model, RelationshipNote } from './data/types'
import type { Pivot } from './layout/layouts'
import { browserStorage, createStore, type Persisted } from './store'
import { deriveSuggestions } from './threads/suggestions'
import { ActionQueue } from './ui/ActionQueue'
import { Canvas, type Focus } from './ui/Canvas'
import { ConnectorKey } from './ui/ConnectorKey'
import { DeviceIndicator } from './ui/Cue'
import { MeetingPage } from './ui/MeetingPage'
import { PersonPage } from './ui/PersonPage'
import { ThemePage } from './ui/ThemePage'
import { PrivacyPanel } from './ui/PrivacyPanel'
import { themeColor } from './ui/theme-colors'

// View state per contracts/ui-state.md. The canvas stays mounted under the person page, so its pivot,
// focus and scroll position are simply still there on return (FR-030).
export type ViewState = {
  pivot: Pivot
  focus: Focus
  queueOpen: boolean
  privacyOpen: boolean
  route: Route
}

// spec 006 contracts/ui.md. `fromPage` = opened from another detail page, so it crossfades instead of flying.
export type Route = { name: 'canvas' } | { name: 'person' | 'meeting' | 'theme'; id: string; fromPage: boolean }

const PIVOTS: { id: Pivot; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'people', label: 'People' },
  { id: 'type', label: 'Meeting type' },
  { id: 'theme', label: 'Theme' },
]

// "Nov 2–13, 2026" from the window's first and last day.
const span = (days: string[]) => {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
  const [a, b] = [days[0], days[days.length - 1]]
  return f(a, { month: 'short' }) === f(b, { month: 'short' })
    ? `${f(a, { month: 'short', day: 'numeric' })}–${f(b, { day: 'numeric' })}, ${f(b, { year: 'numeric' })}`
    : `${f(a, { month: 'short', day: 'numeric' })} – ${f(b, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

export default function App() {
  const [loaded, setLoaded] = useState<Model | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [view, setView] = useState<ViewState>({ pivot: 'project', focus: null, queueOpen: false, privacyOpen: false, route: { name: 'canvas' } })
  const store = useMemo(() => createStore(browserStorage()), [])
  const [version, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    loadModel().then(setLoaded, setError)
  }, [])

  const save = useCallback(
    (fn: (s: Persisted) => Persisted) => {
      store.update(fn)
      bump()
    },
    [store],
  )
  const decide = (fn: (d: Persisted['decisions']) => Persisted['decisions']) => save((s) => ({ ...s, decisions: fn({ ...s.decisions }) }))

  // Every view reads the model with privacy applied (contracts/ui-state.md).
  const privacyKey = JSON.stringify(store.state.privacy)
  const model = useMemo(() => (loaded ? applyPrivacy(loaded, store.state.privacy) : null), [loaded, privacyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => (model ? deriveSuggestions(model, store.state.decisions) : []), [model, store, version])
  // An action item counts as done once a suggestion drawn from it is on an agenda (data-model.md).
  const doneItems = useMemo(() => {
    const turns = new Set(suggestions.filter((s) => s.status === 'accepted').flatMap((s) => s.sources.map((x) => x.turnId)))
    return new Set((model?.actionItems ?? []).filter((a) => turns.has(a.sourceTurnId)).map((a) => a.id))
  }, [suggestions, model])
  const pendingCount = suggestions.filter((s) => s.status === 'pending' && s.targetMeetingId).length

  // Focusing a suggestion from anywhere opens the queue, so its accept and dismiss controls are at hand.
  const setFocus = useCallback((focus: Focus) => setView((v) => ({ ...v, focus, queueOpen: v.queueOpen || focus?.kind === 'suggestion' })), [])
  const open = useCallback(
    (name: 'person' | 'meeting' | 'theme', id: string) =>
      setView((v) => ({ ...v, privacyOpen: false, route: { name, id, fromPage: v.route.name !== 'canvas' } })),
    [],
  )
  const openPerson = useCallback((id: string) => open('person', id), [open])
  const openMeeting = useCallback((id: string) => open('meeting', id), [open])
  const openTheme = useCallback((id: string) => open('theme', id), [open])
  const toCanvas = useCallback(() => setView((v) => ({ ...v, route: { name: 'canvas' } })), [])
  // From any card or page: back to the calendar with the suggestion in focus, and the queue open on it.
  const showInQueue = useCallback(
    (id: string) => setView((v) => ({ ...v, route: { name: 'canvas' }, privacyOpen: false, queueOpen: true, focus: { kind: 'suggestion', id } })),
    [],
  )
  const toggleHidden = useCallback((id: string) => save((s) => ({ ...s, privacy: { ...s.privacy, hiddenMeetingIds: toggle(s.privacy.hiddenMeetingIds, id) } })), [save])
  const toggleExcluded = (id: string) => save((s) => ({ ...s, privacy: { ...s.privacy, excludedPersonIds: toggle(s.privacy.excludedPersonIds, id) } }))
  const saveNote = (n: RelationshipNote) => save((s) => ({ ...s, notes: [...s.notes.filter((x) => x.id !== n.id), n] }))
  const deleteNote = (id: string) => save((s) => ({ ...s, notes: s.notes.filter((x) => x.id !== id) }))

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Meeting Threads</h1>
          {model && (
            <span className="context num">
              {span(model.days)} · {model.meetings.length} meetings · {model.projects.length} projects · {model.themes.length} themes
            </span>
          )}
        </div>
        <nav className="pivots" aria-label="Arrange meetings by">
          {PIVOTS.map((p) => (
            <button key={p.id} aria-pressed={view.pivot === p.id} onClick={() => setView({ ...view, pivot: p.id })}>
              {p.label}
            </button>
          ))}
        </nav>
        <button className="device-btn" aria-pressed={view.privacyOpen} onClick={() => setView({ ...view, privacyOpen: !view.privacyOpen })}>
          <DeviceIndicator saved={store.saved} />
        </button>
        <button className="queue-btn" aria-pressed={view.queueOpen} onClick={() => setView({ ...view, queueOpen: !view.queueOpen })}>
          Action queue {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
        </button>
      </header>
      {store.banner && <div className="banner">{store.banner}</div>}
      {error ? (
        <div className="error" role="alert">
          <h2>The data could not be loaded</h2>
          {error instanceof DataError ? (
            <dl>
              <dt>File</dt><dd>{error.file}</dd>
              <dt>Record</dt><dd>{error.recordId}</dd>
              <dt>Field</dt><dd>{error.field}</dd>
            </dl>
          ) : null}
          <pre>{error.message}</pre>
        </div>
      ) : model && loaded ? (
        <div className="main">
          <div className="main-col">
            <Canvas
              model={model}
              pivot={view.pivot}
              focus={view.focus}
              onFocus={setFocus}
              suggestions={suggestions}
              doneItems={doneItems}
              onOpenPerson={openPerson}
              onOpenMeeting={openMeeting}
              onOpenTheme={openTheme}
              onToggleHidden={toggleHidden}
              onShowInQueue={showInQueue}
            />
            <nav className="legend" aria-label="Key">
              <ConnectorKey />
              <span className="legend-sep" aria-hidden="true" />
              <span className="legend-head">Themes</span>
              {model.themes.map((t) => {
                const on = view.focus?.kind === 'theme' && view.focus.id === t.id
                return (
                  <span key={t.id} className="chip-group">
                    <button aria-pressed={on} onClick={() => setFocus(on ? null : { kind: 'theme', id: t.id })}>
                      <i style={{ background: themeColor(t.color) }} />
                      {t.name}
                      <span className="chip-count num">{t.meetingIds.length}</span>
                    </button>
                    {on && (
                      <button className="chip-open" onClick={() => openTheme(t.id)} aria-label={`Open the ${t.name} page`}>
                        Open
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>
          </div>
          <AnimatePresence>
            {view.queueOpen && (
              <ActionQueue
                model={model}
                suggestions={suggestions}
                focusedId={view.focus?.kind === 'suggestion' ? view.focus.id : null}
                onFocus={(id) => setFocus({ kind: 'suggestion', id })}
                onAccept={(id, text) => decide((d) => ({ ...d, [id]: { status: 'accepted', ...(text ? { text } : {}), at: new Date().toISOString() } }))}
                onDismiss={(id) => decide((d) => ({ ...d, [id]: { status: 'dismissed', at: new Date().toISOString() } }))}
                onReset={(id) => decide((d) => { delete d[id]; return d })}
                onClose={() => setView({ ...view, queueOpen: false })}
              />
            )}
          </AnimatePresence>
          {view.route.name === 'person' && (
            <PersonPage
              key={`person:${view.route.id}`}
              model={model}
              personId={view.route.id}
              fromPage={view.route.fromPage}
              doneItems={doneItems}
              notes={store.state.notes}
              onSaveNote={saveNote}
              onDeleteNote={deleteNote}
              onClose={toCanvas}
              onOpenMeeting={openMeeting}
              onOpenTheme={openTheme}
              suggestions={suggestions}
              onShowInQueue={showInQueue}
            />
          )}
          {view.route.name === 'meeting' && (
            <MeetingPage
              key={`meeting:${view.route.id}`}
              model={model}
              meetingId={view.route.id}
              suggestions={suggestions}
              doneItems={doneItems}
              fromPage={view.route.fromPage}
              onClose={toCanvas}
              onOpenPerson={openPerson}
              onOpenMeeting={openMeeting}
              onOpenTheme={openTheme}
              onToggleHidden={toggleHidden}
              onShowInQueue={showInQueue}
            />
          )}
          {view.route.name === 'theme' && (
            <ThemePage
              key={`theme:${view.route.id}`}
              model={model}
              themeId={view.route.id}
              suggestions={suggestions}
              doneItems={doneItems}
              fromPage={view.route.fromPage}
              onClose={toCanvas}
              onOpenPerson={openPerson}
              onOpenMeeting={openMeeting}
              onShowInQueue={showInQueue}
            />
          )}
          <AnimatePresence>
            {view.privacyOpen && (
              <PrivacyPanel
                model={loaded}
                privacy={store.state.privacy}
                saved={store.saved}
                onToggleHidden={toggleHidden}
                onToggleExcluded={toggleExcluded}
                onClose={() => setView({ ...view, privacyOpen: false })}
              />
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="loading">Loading two weeks…</div>
      )}
    </div>
  )
}
