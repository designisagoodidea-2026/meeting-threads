import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { applyImport, buildWithImports, type Import } from './data/extract'
import { DataError, buildModel, loadFiles } from './data/load'
import { applyPrivacy } from './data/privacy'
import type { Model, RelationshipNote } from './data/types'
import type { Pivot } from './layout/layouts'
import { browserStorage, createStore, type Persisted } from './store'
import { groupQueue } from './threads/queue'
import { deriveSuggestions } from './threads/suggestions'
import { ActionQueue } from './ui/ActionQueue'
import { Canvas, type Focus } from './ui/Canvas'
import { ConnectorKey } from './ui/ConnectorKey'
import { Guide } from './ui/Guide'
import { DeviceIndicator } from './ui/Cue'
import { when } from './ui/format'
import { Icon } from './ui/Icon'
import { MeetingPage } from './ui/MeetingPage'
import { PersonPage } from './ui/PersonPage'
import { ThemePage } from './ui/ThemePage'
import { ImportPanel } from './ui/ImportPanel'
import { PrivacyPanel } from './ui/PrivacyPanel'
import { themeColor } from './ui/theme-colors'

// View state per contracts/ui-state.md. The canvas stays mounted under the person page, so its pivot,
// focus and scroll position are simply still there on return (FR-030).
export type ViewState = {
  pivot: Pivot
  focus: Focus
  queueOpen: boolean
  privacyOpen: boolean
  importOpen?: boolean
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
  const [files, setFiles] = useState<Awaited<ReturnType<typeof loadFiles>> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [view, setView] = useState<ViewState>({ pivot: 'project', focus: null, queueOpen: false, privacyOpen: false, route: { name: 'canvas' } })
  const store = useMemo(() => createStore(browserStorage()), [])
  const [version, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    loadFiles().then(setFiles, setError)
  }, [])

  const save = useCallback(
    (fn: (s: Persisted) => Persisted) => {
      store.update(fn)
      bump()
    },
    [store],
  )
  // The bundled files plus any pasted transcripts, rebuilt whenever an import changes in any way.
  // Keyed on the imports alone: rebuilding on every note or decision would redo every layout.
  const importsKey = JSON.stringify(store.state.imports ?? {})
  const [loaded, importError] = useMemo((): [Model | null, string | null] => {
    if (!files) return [null, null]
    try {
      const { model, skipped } = buildWithImports(files, store.state.imports ?? {})
      return [model, skipped.length ? `An imported transcript could not be applied (${skipped.join(', ')}). Remove it from Import.` : null]
    } catch (e) {
      setTimeout(() => setError(e as Error))
      return [null, null]
    }
  }, [files, importsKey]) // eslint-disable-line react-hooks/exhaustive-deps
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
  // The last accept or dismiss, for the confirmation toast and its undo (FR-029).
  const [change, setChange] = useState<{ id: string; status: 'accepted' | 'dismissed'; key: number } | null>(null)
  useEffect(() => {
    if (!change) return
    const t = setTimeout(() => setChange(null), 8000)
    return () => clearTimeout(t)
  }, [change])
  const changed = change && suggestions.find((s) => s.id === change.id && s.status === change.status)
  const undo = (id: string) => {
    decide((d) => { delete d[id]; return d })
    setChange(null)
  }
  // U in the queue undoes the most recent decision still standing, this session.
  const decided = useRef<string[]>([])
  const undoLast = () => {
    const d = store.state.decisions
    while (decided.current.length) {
      const id = decided.current.pop()!
      if (d[id]) return undo(id)
    }
  }
  // First-run tour: shown until finished or skipped once; step 2 onward needs the queue open on an item.
  const [guide, setGuide] = useState<number | null>(() => (store.state.guideDone ? null : 0))
  const guideStep = (n: number) => {
    setGuide(n)
    if (n >= 1) {
      const first = model && groupQueue(model, suggestions).flatMap((g) => g.items).find((s) => s.status === 'pending' && s.targetMeetingId)
      setView((v) => ({ ...v, route: { name: 'canvas' }, privacyOpen: false, queueOpen: true, focus: first && n === 2 ? { kind: 'suggestion', id: first.id } : v.focus }))
    }
  }
  const endGuide = () => {
    setGuide(null)
    if (!store.state.guideDone) save((s) => ({ ...s, guideDone: true }))
  }
  // Validates before saving, so a bad import never lands. Returns why it was refused.
  const applyOne = (imp: Import): string | null => {
    if (!files) return 'Still loading'
    try {
      let f = files
      for (const other of Object.values(store.state.imports ?? {})) if (other.transcript.eventId !== imp.transcript.eventId) f = applyImport(f, other)
      f = applyImport(f, imp)
      buildModel(f.calendar, f.transcripts, f.annotations)
    } catch (e) {
      return (e as Error).message
    }
    save((s) => ({ ...s, imports: { ...s.imports, [imp.transcript.eventId]: imp } }))
    return null
  }
  const removeImport = (id: string) => save((s) => { const imports = { ...s.imports }; delete imports[id]; return { ...s, imports } })
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
  if (import.meta.env.DEV) (window as unknown as { __showInQueue: typeof showInQueue }).__showInQueue = showInQueue // browser checks only
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
        <button className="tour-btn" onClick={() => guideStep(0)} aria-pressed={guide !== null}>Tour</button>
        <button className="tour-btn import-btn" onClick={() => setView({ ...view, privacyOpen: false, importOpen: !view.importOpen })} aria-pressed={!!view.importOpen}>Import</button>
        <button className="device-btn" aria-pressed={view.privacyOpen} onClick={() => setView({ ...view, importOpen: false, privacyOpen: !view.privacyOpen })}>
          <DeviceIndicator saved={store.saved} />
        </button>
        <button className="queue-btn" aria-pressed={view.queueOpen} onClick={() => setView({ ...view, queueOpen: !view.queueOpen })}>
          Action queue {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
        </button>
      </header>
      {store.banner && <div className="banner">{store.banner}</div>}
      {importError && <div className="banner">{importError}</div>}
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
                onAccept={(id, text) => {
                  decide((d) => ({ ...d, [id]: { status: 'accepted', ...(text ? { text } : {}), at: new Date().toISOString() } }))
                  setChange({ id, status: 'accepted', key: Date.now() })
                  decided.current.push(id)
                  setFocus({ kind: 'suggestion', id }) // the canvas brings the now-solid line into view
                }}
                onDismiss={(id) => {
                  decide((d) => ({ ...d, [id]: { status: 'dismissed', at: new Date().toISOString() } }))
                  setChange({ id, status: 'dismissed', key: Date.now() })
                  decided.current.push(id)
                }}
                onReset={undo}
                onUndoLast={undoLast}
                keysActive={view.route.name === 'canvas' && !view.importOpen && !view.privacyOpen && guide === null}
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
          {guide !== null && <Guide step={guide} onStep={guideStep} onClose={endGuide} />}
          <div className="toast-slot" role="status" aria-live="polite">
            <AnimatePresence>
              {changed && (
                <motion.div
                  key={change!.key}
                  className="toast"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
                >
                  <span>
                    {changed.status === 'accepted' ? (
                      <>
                        Added to the agenda for <b>{model.meetingById.get(changed.targetMeetingId!)!.title}</b>, {when(model.meetingById.get(changed.targetMeetingId!)!, model.timeZone)}
                      </>
                    ) : (
                      <>Dismissed “{changed.text}”</>
                    )}
                  </span>
                  <button onClick={() => undo(changed.id)}>Undo</button>
                  <button className="pop-close" onClick={() => setChange(null)} aria-label="Close"><Icon name="close" /></button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {view.importOpen && (
              <ImportPanel
                model={loaded}
                imports={store.state.imports ?? {}}
                onApply={applyOne}
                onRemove={removeImport}
                onClose={() => setView({ ...view, importOpen: false })}
              />
            )}
          </AnimatePresence>
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
