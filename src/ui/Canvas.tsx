import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Model, Suggestion } from '../data/types'
import { placeLabels, type Placed } from '../layout/labels'
import { computeLayout, type Item, type Layout, type Pivot } from '../layout/layouts'
import { DURATION, interpolate, lift, MAX_DELAY } from '../layout/tween'
import { explainConnector, type Connector } from '../threads/explain'
import { itemLines, keyFor } from '../threads/threads'
import { BeadCard, MeetingCard } from './Cards'
import { MeetingBlock } from './MeetingBlock'
import { useReducedMotion } from './reduced-motion'
import { themeColor } from './theme-colors'
import { ConnectorCard } from './ConnectorCard'
import { ThreadLayer, type Arc, type ThreadLayerHandle } from './ThreadLayer'

const DAY_W = 600
const HEAD_H = 44
const REDUCED_S = 0.15

export type Focus = { kind: 'theme' | 'meeting' | 'suggestion'; id: string } | null

type Transition = { from: Layout; to: Layout; animate: boolean }

const LABEL_FONT = '600 11.5px Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
const LABEL_MAX = 190
let measureCtx: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()
function labelWidth(title: string) {
  if (!widths.has(title)) {
    measureCtx ??= document.createElement('canvas').getContext('2d')!
    measureCtx.font = LABEL_FONT
    widths.set(title, Math.min(LABEL_MAX, Math.ceil(measureCtx.measureText(title).width)) + 14) // + chip padding and border
  }
  return widths.get(title)!
}

type Props = {
  model: Model
  pivot: Pivot
  focus: Focus
  onFocus: (f: Focus) => void
  suggestions: Suggestion[]
  doneItems: Set<string>
  onOpenPerson: (id: string) => void
  onOpenMeeting: (id: string) => void
  onOpenTheme: (id: string) => void
  onToggleHidden: (meetingId: string) => void
  onShowInQueue: (suggestionId: string) => void
}

export function Canvas({ model, pivot, focus, onFocus, suggestions, doneItems, onOpenPerson, onOpenMeeting, onOpenTheme, onToggleHidden, onShowInQueue }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [bodyH, setBodyH] = useState(0)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const el = scroller.current!
    const measure = () => setBodyH(Math.max(240, el.clientHeight - HEAD_H - 14))
    measure() // don't wait for the observer: it only reports on a rendered frame, and a background tab may not render one
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frame = useMemo(() => (bodyH ? computeLayout(model, pivot, { dayWidth: DAY_W, height: bodyH }) : null), [model, pivot, bodyH])

  // The applied boxes (absolute z included), so an interrupted pivot starts from where blocks are.
  const current = useRef<Layout | null>(null)
  const lastPivot = useRef(pivot)
  const [tr, setTr] = useState<Transition | null>(null)
  const [animating, setAnimating] = useState(false)

  useLayoutEffect(() => {
    if (!frame) return
    const resizeOnly = !current.current || lastPivot.current === pivot
    lastPivot.current = pivot
    setTr({ from: resizeOnly ? frame.items : new Map(current.current!), to: frame.items, animate: !resizeOnly })
  }, [frame]) // eslint-disable-line react-hooks/exhaustive-deps

  const els = useRef(new Map<string, HTMLDivElement>())
  const labelEls = useRef(new Map<string, HTMLDivElement>())
  const threads = useRef<ThreadLayerHandle>(null)
  const placed = useMemo(() => {
    if (!tr) return null
    const place = (l: Layout) =>
      placeLabels(
        [...l].filter(([, it]) => it.label).map(([key, it]) => ({ key, row: it.label!.row, x: it.x, areaY: it.label!.y, areaH: it.label!.h })),
        (key) => labelWidth(model.meetingById.get(l.get(key)!.meetingId)!.title),
      )
    return { from: place(tr.from), to: place(tr.to) }
  }, [tr, model])
  const placedRef = useRef(placed)
  placedRef.current = placed
  const progress = useMotionValue(1)
  const trRef = useRef(tr)
  trRef.current = tr

  const apply = useCallback(
    (p: number) => {
      const t = trRef.current
      if (!t || !frame) return
      const delayOf = (key: string) => {
        const it = t.from.get(key) ?? t.to.get(key)
        return it ? (it.x / frame.width) * MAX_DELAY : 0
      }
      const lay = interpolate(t.from, t.to, reduced ? (p < 0.5 ? 0 : 1) : p, reduced ? undefined : delayOf)
      const prev = current.current
      const next: Layout = new Map()
      for (const [key, it] of lay) {
        const el = els.current.get(key)
        const l = reduced ? { z: 0, scale: 1, shadow: 0 } : lift(it.t ?? 1)
        const z = (it.z ?? 0) + l.z
        // Tilt in the direction of travel for a sense of depth.
        const dy = prev?.get(key) ? it.y - prev.get(key)!.y : 0
        const tilt = Math.max(-14, Math.min(14, dy * 0.6)) * l.shadow
        next.set(key, { ...it, z })
        if (!el) continue
        el.style.transform = `translate3d(${it.x}px, ${it.y}px, 0) perspective(900px) translateZ(${z}px) rotateX(${-tilt}deg) scale(${l.scale})`
        el.style.width = `${it.w}px`
        el.style.height = `${it.h}px`
        el.style.zIndex = String(Math.round(z) + 1)
        el.style.opacity = reduced ? String(Math.abs(1 - 2 * p)) : ''
        ;(el.firstElementChild as HTMLElement).style.opacity = String(Math.max(l.shadow, z / 70))

        // Labels sit in their own layer above every block. They fade out on take-off and back in on landing,
        // moving between their old and new tier on the way.
        const lab = labelEls.current.get(key)
        const pl = placedRef.current
        if (!lab || !pl) continue
        const to: Placed | undefined = pl.to.get(key)
        const from: Placed | undefined = pl.from.get(key) ?? to
        const tt = reduced ? (p < 0.5 ? 0 : 1) : (it.t ?? 1)
        const ly = (from?.dy ?? 0) + ((to?.dy ?? 0) - (from?.dy ?? 0)) * tt
        const op = tt < 0.5 ? (from?.visible ? 1 - 2 * tt : 0) : to?.visible ? 2 * tt - 1 : 0
        lab.style.transform = `translate3d(${it.x}px, ${it.y + ly}px, 0)`
        lab.style.opacity = String(op)
        lab.style.maxWidth = `${LABEL_MAX + 14}px`
      }
      current.current = next
      threads.current?.draw(lay)
    },
    [frame, reduced],
  )
  useMotionValueEvent(progress, 'change', apply)

  useLayoutEffect(() => {
    if (!tr) return
    if (!tr.animate) {
      apply(1)
      setAnimating(false)
      return
    }
    progress.jump(0)
    apply(0)
    setAnimating(true)
    const ctl = animate(progress, 1, {
      duration: reduced ? REDUCED_S : DURATION,
      ease: 'linear',
      onComplete: () => setTr({ from: tr.to, to: tr.to, animate: false }),
    })
    return () => ctl.stop()
  }, [tr]) // eslint-disable-line react-hooks/exhaustive-deps

  const keys = useMemo(() => (tr ? [...new Set([...tr.from.keys(), ...tr.to.keys()])] : []), [tr])
  const [hover, setHover] = useState<string | null>(null)
  const [bead, setBead] = useState<string | null>(null)

  // What the current focus lights up: themes (threads) and meetings (everything else dims).
  const lit = useMemo(() => {
    if (!focus) return null
    if (focus.kind === 'theme') {
      const t = model.themes.find((x) => x.id === focus.id)!
      return { themes: new Set([t.id]), meetings: new Set(t.meetingIds) }
    }
    if (focus.kind === 'meeting') {
      const m = model.meetingById.get(focus.id)!
      const themes = new Set(m.themeIds)
      return { themes, meetings: new Set([m.id, ...model.themes.filter((t) => themes.has(t.id)).flatMap((t) => t.meetingIds)]) }
    }
    const s = suggestions.find((x) => x.id === focus.id)
    if (!s) return null
    return { themes: new Set<string>(), meetings: new Set([...s.sources.map((x) => x.meetingId), ...(s.targetMeetingId ? [s.targetMeetingId] : [])]) }
  }, [focus, model, suggestions])

  const arcs = useMemo(() => {
    const out: Arc[] = []
    const themeIds = new Set(model.themes.map((t) => t.id))
    for (const s of suggestions) {
      if (!s.targetMeetingId) continue
      const focused = focus?.kind === 'suggestion' && focus.id === s.id
      // An accepted action item already draws its own line to the agenda (research R3a), so only theme
      // follow-ups keep a standing arc; any suggestion still gets one while it is focused.
      const fromItem = !themeIds.has(s.id.slice(s.id.indexOf(':') + 1))
      if (!focused && (s.status !== 'accepted' || fromItem)) continue
      for (const src of s.sources)
        out.push({ id: `${s.id}|${src.meetingId}`, suggestionId: s.id, from: src.meetingId, to: s.targetMeetingId, accepted: s.status === 'accepted', focused })
    }
    return out
  }, [suggestions, focus, model])

  // The connector card (spec 006 US1): one at a time, gone on leave, blur, Escape, scroll and pivot.
  const [hoverConn, setHoverConn] = useState<{ c: Connector; at: { x: number; y: number } } | null>(null)
  // Accessible labels, cached until the data or suggestions change: every render of the thread layer
  // asks for ~170 of them, and an action item's label scans all suggestions.
  const labelCache = useMemo(() => new Map<string, string>(), [model, suggestions])
  const labelFor = useCallback(
    (c: Connector) => {
      const key = JSON.stringify(c)
      let label = labelCache.get(key)
      if (label === undefined) {
        const head = explainConnector(model, c, suggestions).headline
        const title = (id: string) => model.meetingById.get(id)!.title
        label = c.kind === 'thread' ? `${head}: ${title(c.from)} and ${title(c.to)}` : head
        labelCache.set(key, label)
      }
      return label
    },
    [model, suggestions, labelCache],
  )
  // The meetings a hovered connector joins get outlined, so the card's "these meetings" is visible.
  const hoverEnds = useMemo(() => {
    if (!hoverConn) return new Set<string>()
    const c = hoverConn.c
    if (c.kind === 'thread') return new Set([c.from, c.to])
    if (c.kind === 'copy') return new Set([c.meetingId])
    if (c.kind === 'bead') return new Set([model.actionItems.find((a) => a.id === c.actionItemId)!.meetingId])
    const sg = suggestions.find((x) => x.id === c.suggestionId)
    return new Set([c.source, ...(sg?.targetMeetingId ? [sg.targetMeetingId] : [])])
  }, [hoverConn, model, suggestions])
  const hoverKey = hoverConn
    ? hoverConn.c.kind === 'thread'
      ? `${hoverConn.c.themeId}:${hoverConn.c.from}:${hoverConn.c.to}`
      : hoverConn.c.kind === 'arc'
        ? `arc:${hoverConn.c.suggestionId}|${hoverConn.c.source}`
        : null
    : null
  const explanation = useMemo(() => (hoverConn ? explainConnector(model, hoverConn.c, suggestions) : null), [hoverConn, model, suggestions])
  useEffect(() => setHoverConn(null), [pivot, tr])
  useEffect(() => {
    const el = scroller.current!
    const hide = () => setHoverConn(null)
    el.addEventListener('scroll', hide, { passive: true })
    return () => el.removeEventListener('scroll', hide)
  }, [])

  // Arcs and focus change what the thread layer draws, so redraw at the current positions.
  useLayoutEffect(() => {
    if (current.current) threads.current?.draw(current.current)
  }, [arcs, pivot, tr])

  // Bring a focused suggestion into view: both ends when they fit, otherwise the target (where an
  // accepted item lands), with the arc arriving from the source on the left.
  useEffect(() => {
    if (focus?.kind !== 'suggestion' || !tr) return
    const sug = suggestions.find((x) => x.id === focus.id)
    if (!sug) return
    const el = scroller.current!
    const xOf = (id: string) => tr.to.get(keyFor(tr.to, id, '') ?? '')?.x
    const xs = sug.sources.map((x) => xOf(x.meetingId)).filter((x): x is number => x !== undefined)
    const target = sug.targetMeetingId ? xOf(sug.targetMeetingId) : undefined
    if (target !== undefined) xs.push(target)
    if (!xs.length) return
    const lo = Math.min(...xs)
    const hi = Math.max(...xs)
    const left = hi - lo < el.clientWidth - 240 ? (lo + hi) / 2 - el.clientWidth / 2 : (target ?? lo) - el.clientWidth * 0.65
    el.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' })
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setBead(null), [pivot])
  useEffect(() => {
    if (focus?.kind !== 'theme') setBead(null)
  }, [focus])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setBead(null)
        setHoverConn(null)
        onFocus(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFocus])

  // There is no vertical scroll, so a plain wheel moves through time.
  useEffect(() => {
    const el = scroller.current!
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const rows = frame?.rows ?? []
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
  const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)))
    return Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)
  }
  // Meetings per row, for the gutter (themes count their meetings, people their shared meetings).
  const inProject = (m: (typeof model.meetings)[number], pid: string) =>
    model.projects.find((p) => p.id === pid)?.themeIds.some((t) => m.themeIds.includes(t)) ?? false
  const rowCount = (key: string) =>
    pivot === 'project'
      ? model.meetings.filter((m) => (key === 'none' ? !model.projects.some((p) => inProject(m, p.id)) : inProject(m, key))).length
      : pivot === 'type'
      ? model.meetings.filter((m) => m.type === key).length
      : pivot === 'people'
        ? model.meetings.filter((m) => m.attendeeIds.includes(key)).length
        : pivot === 'theme'
          ? key === 'none'
            ? model.meetings.filter((m) => !m.themeIds.length).length
            : (model.themes.find((t) => t.id === key)?.meetingIds.length ?? 0)
          : model.meetings.length
  const settled = tr && !animating
  const anchor = (meetingId: string): Item | undefined => (tr ? tr.to.get(keyFor(tr.to, meetingId, '') ?? '') : undefined)
  const beadAt = bead && tr ? itemLines(model, tr.to, suggestions).find((l) => l.actionItemId === bead)?.bead : undefined
  const cardMeeting = focus?.kind === 'meeting' ? anchor(focus.id) : undefined

  return (
    <div className={`canvas${lit ? ' has-focus' : ''}`} data-pivot={pivot}>
      {focus && (
        // What's selected, and the way out of it, always in view (FR-033).
        <div className="selection-chip" role="status">
          <span className="sel-kind">{focus.kind === 'suggestion' ? 'Suggestion' : focus.kind === 'theme' ? 'Theme' : 'Meeting'}</span>
          <span className="sel-name">
            {focus.kind === 'meeting'
              ? model.meetingById.get(focus.id)?.title
              : focus.kind === 'theme'
                ? model.themes.find((t) => t.id === focus.id)?.name
                : suggestions.find((x) => x.id === focus.id)?.text}
          </span>
          <button onClick={() => { setBead(null); onFocus(null) }} aria-label="Clear selection (Escape)">
            Clear <kbd>Esc</kbd>
          </button>
        </div>
      )}
      <div className="gutter" style={{ paddingTop: HEAD_H }}>
        <AnimatePresence initial={false}>
          <motion.div
            key={pivot}
            className="gutter-rows"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.35, delay: reduced ? 0 : 0.25 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {rows.map((r) => {
              const isTheme = pivot === 'theme' && r.key !== 'none'
              const isPerson = pivot === 'people'
              const Tag = isTheme || isPerson ? 'button' : 'div'
              return (
                <Fragment key={r.key}>
                <Tag
                  className={`row-label${isTheme && focus?.kind === 'theme' && focus.id === r.key ? ' active' : ''}`}
                  style={{ top: r.y, height: r.h }}
                  {...(isTheme ? { onClick: () => onFocus(focus?.kind === 'theme' && focus.id === r.key ? null : { kind: 'theme', id: r.key }) } : {})}
                  {...(isPerson ? { onClick: () => onOpenPerson(r.key), title: `Open ${r.label}` } : {})}
                >
                  {r.color && <i style={{ background: themeColor(r.color) }} />}
                  {pivot === 'type' && <i className="type-swatch" data-type={r.key} />}
                  <span className="name">{r.label}</span>
                  {r.sublabel && r.h >= 34 && <span className="sub">{r.sublabel}</span>}
                  <span className="count num" aria-label={`${rowCount(r.key)} meetings`}>{rowCount(r.key)}</span>
                </Tag>
                {isTheme && focus?.kind === 'theme' && focus.id === r.key && (
                  <button className="row-open" style={{ top: r.y + r.h / 2 - 12 }} onClick={() => onOpenTheme(r.key)} aria-label={`Open the ${r.label} page`}>
                    Open
                  </button>
                )}
                </Fragment>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="scroller" ref={scroller}>
        <div className="stage" style={{ width: model.days.length * DAY_W, height: HEAD_H + bodyH }}>
          <div className="day-heads" style={{ height: HEAD_H }}>
            {model.days.map((d, i) => {
              const date = new Date(`${d}T12:00:00Z`)
              return (
              <div key={d} className={`day-head${i % 5 === 0 ? ' week-start' : ''}`} style={{ left: i * DAY_W, width: DAY_W }}>
                <span className="day-date">
                  <b className="num">{date.getUTCDate()}</b>
                  <span className="day-name">{weekday.format(date)}</span>
                  {i % 5 === 0 && (
                    <span className="day-week">
                      {month.format(date)} · Week {isoWeek(date)}
                    </span>
                  )}
                </span>
                <span className="hours">
                  {[9, 11, 13, 15, 17].map((h) => (
                    <em key={h} className="num" style={{ left: ((h - 8) / 10) * DAY_W }}>
                      {h > 12 ? h - 12 : h}
                      <small>{h >= 12 ? 'pm' : 'am'}</small>
                    </em>
                  ))}
                </span>
              </div>
              )
            })}
          </div>
          <div
            className="body"
            style={{ top: HEAD_H, height: bodyH, ['--day-w' as string]: `${DAY_W}px` }}
            onClick={(e) => {
              const t = e.target as HTMLElement
              if (t === e.currentTarget || t.classList.contains('band') || t.tagName === 'svg') {
                setBead(null)
                onFocus(null)
              }
            }}
          >
            <AnimatePresence initial={false}>
              <motion.div key={pivot} className="bands" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                {rows.map((r, i) => (
                  <div key={r.key} className={`band${i % 2 ? ' odd' : ''}`} style={{ top: r.y, height: r.h }} />
                ))}
              </motion.div>
            </AnimatePresence>
            {keys.map((key) => {
              const meetingId = (tr!.to.get(key) ?? tr!.from.get(key))!.meetingId
              return (
                <MeetingBlock
                  key={key}
                  ref={(el) => {
                    if (el) els.current.set(key, el)
                    else els.current.delete(key)
                  }}
                  model={model}
                  meeting={model.meetingById.get(meetingId)!}
                  item={tr!.to.get(key)}
                  split={pivot === 'people' && !animating}
                  linked={pivot === 'theme' && hover === meetingId}
                  dimmed={!!lit && !lit.meetings.has(meetingId)}
                  selected={(focus?.kind === 'meeting' && focus.id === meetingId) || hoverEnds.has(meetingId)}
                  onHover={setHover}
                  onOpen={onOpenMeeting}
                  onSelect={(id) => {
                    setBead(null)
                    onFocus(focus?.kind === 'meeting' && focus.id === id ? null : { kind: 'meeting', id })
                  }}
                />
              )
            })}
            {frame && (
              <ThreadLayer
                ref={threads}
                model={model}
                width={frame.width}
                height={bodyH}
                litThemes={lit?.themes ?? null}
                arcs={arcs}
                suggestions={suggestions}
                doneItems={doneItems}
                showCopyLinks={pivot === 'theme' || pivot === 'project' || animating}
                labelFor={labelFor}
                hoverKey={hoverKey}
                onEnter={(c, at) => setHoverConn({ c, at })}
                onLeave={() => setHoverConn(null)}
                onThemeClick={onOpenTheme}
                onBeadClick={(id) => {
                  setHoverConn(null)
                  setBead(id)
                  const a = model.actionItems.find((x) => x.id === id)!
                  onFocus({ kind: 'theme', id: a.themeId! })
                }}
              />
            )}
            <div className="labels" aria-hidden="true">
              {keys.map((key) => {
                const m = model.meetingById.get((tr!.to.get(key) ?? tr!.from.get(key))!.meetingId)!
                return (
                  <div
                    key={key}
                    ref={(el) => {
                      if (el) labelEls.current.set(key, el)
                      else labelEls.current.delete(key)
                    }}
                    className={`label${pivot === 'theme' && hover === m.id ? ' linked' : ''}${lit && !lit.meetings.has(m.id) ? ' dimmed' : ''}`}
                    data-type={m.type}
                  >
                    {m.title}
                  </div>
                )
              })}
            </div>
            {settled && hoverConn && explanation && (
              <ConnectorCard
                model={model}
                explanation={explanation}
                at={hoverConn.at}
                view={{ left: scroller.current?.scrollLeft ?? 0, width: scroller.current?.clientWidth ?? frame!.width, height: bodyH }}
              />
            )}
            <AnimatePresence>
              {settled && beadAt && (
                <BeadCard
                  key={`bead-${bead}`}
                  model={model}
                  actionItemId={bead!}
                  done={doneItems.has(bead!)}
                  x={beadAt.x}
                  y={beadAt.y}
                  bodyH={bodyH}
                  onClose={() => setBead(null)}
                  onOpenPerson={onOpenPerson}
                  onOpenMeeting={onOpenMeeting}
                  suggestions={suggestions}
                  onShowInQueue={onShowInQueue}
                />
              )}
              {settled && !beadAt && focus?.kind === 'meeting' && cardMeeting && (
                <MeetingCard
                  key={`meeting-${focus.id}`}
                  model={model}
                  meetingId={focus.id}
                  suggestions={suggestions}
                  box={cardMeeting}
                  bodyH={bodyH}
                  stageW={frame!.width}
                  onClose={() => onFocus(null)}
                  onFocusSuggestion={onShowInQueue}
                  onOpenPerson={onOpenPerson}
                  onOpenMeeting={onOpenMeeting}
                  onToggleHidden={onToggleHidden}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
