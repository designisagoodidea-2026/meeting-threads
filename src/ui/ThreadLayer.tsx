import { forwardRef, useImperativeHandle, useMemo, useRef, type FocusEvent, type PointerEvent } from 'react'
import type { Model, Suggestion } from '../data/types'
import type { Layout } from '../layout/layouts'
import type { Connector } from '../threads/explain'
import { copyLinks, itemLines, keyFor, threadSegments } from '../threads/threads'
import { themeColor } from './theme-colors'

export type ThreadLayerHandle = { draw: (layout: Layout) => void }
export type Arc = { id: string; suggestionId: string; from: string; to: string; accepted: boolean; focused: boolean }
type Pt = { x: number; y: number }

type Props = {
  model: Model
  width: number
  height: number
  litThemes: Set<string> | null // null = nothing focused
  arcs: Arc[]
  suggestions: Suggestion[]
  doneItems: Set<string>
  showCopyLinks: boolean
  labelFor: (c: Connector) => string
  hoverKey: string | null // the connector whose card is showing, drawn emphasised
  onEnter: (c: Connector, at: Pt) => void
  onLeave: () => void
  onThemeClick: (themeId: string) => void
  onBeadClick: (actionItemId: string) => void
}

const HOVER_MS = 80 // so cards don't flicker as the pointer crosses lines (research R4)

// Connector styles differ in more than color (spec 006 research R3, R3a): theme threads are solid in the
// theme's color; suggestion arcs arch above with an arrowhead, dashed while pending; same-meeting links
// are dotted with open end circles; action items are dots at their source meeting, with an arrowed line
// to the agenda they're committed to, or a fading stub and "?" when nothing is committed yet.
//
// Every path's `d` is written by `draw`, which Canvas calls each animation frame with the same
// interpolated layout the blocks use, so connectors stay attached mid-flight.
//
// shortcut: every connector is its own tab stop (~100 in the theme layout); a real build would make
// this layer one tab stop with arrow keys moving between connectors.
export const ThreadLayer = forwardRef<ThreadLayerHandle, Props>(function ThreadLayer(props, ref) {
  const { model, width, height, litThemes, arcs, suggestions, doneItems, showCopyLinks, labelFor, hoverKey, onEnter, onLeave, onThemeClick, onBeadClick } = props
  const svg = useRef<SVGSVGElement>(null)
  const paths = useRef(new Map<string, SVGPathElement>())
  const beads = useRef(new Map<string, SVGGElement>())
  const marks = useRef(new Map<string, SVGGElement>())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const ids = useMemo(() => {
    // Every run a thread can take: once across rows, and once along each project row it belongs to.
    const segs: { id: string; themeId: string; from: string; to: string }[] = []
    for (const t of model.themes)
      for (const row of [null, ...t.projectIds.filter((p) => p !== t.id)])
        for (let i = 1; i < t.meetingIds.length; i++) {
          const base = `${t.id}:${t.meetingIds[i - 1]}:${t.meetingIds[i]}`
          segs.push({ id: row ? `${base}@${row}` : base, themeId: t.id, from: t.meetingIds[i - 1], to: t.meetingIds[i] })
        }
    return segs
  }, [model])
  const copyIds = useMemo(
    () =>
      model.meetings.flatMap((m) => {
        // A meeting has one copy per theme (theme pivot) or per project it touches (project pivot).
        const copies = Math.max(m.themeIds.length, model.projects.filter((p) => p.themeIds.some((t) => m.themeIds.includes(t))).length)
        return Array.from({ length: Math.max(0, copies - 1) }, (_, i) => ({ id: `${m.id}:${i + 1}`, meetingId: m.id }))
      }),
    [model],
  )
  const color = (themeId: string) => themeColor(model.themes.find((t) => t.id === themeId)?.color)

  useImperativeHandle(
    ref,
    () => ({
      draw(layout) {
        const set = (key: string, d: string | null) => {
          paths.current.get(key)?.setAttribute('d', d ?? '')
          paths.current.get(`hit:${key}`)?.setAttribute('d', d ?? '')
          paths.current.get(`case:${key}`)?.setAttribute('d', d ?? '')
        }
        const segs = threadSegments(model, layout)
        const seen = new Set<string>()
        for (const s of segs) {
          set(s.id, s.path)
          seen.add(s.id)
        }
        for (const { id } of ids) if (!seen.has(id)) set(id, null)
        const links = new Map(copyLinks(layout).map((l) => [l.id, l.path]))
        for (const { id } of copyIds) set(`copy:${id}`, links.get(id) ?? null)
        for (const a of arcs) {
          const fk = keyFor(layout, a.from, '')
          const tk = keyFor(layout, a.to, '')
          if (!fk || !tk) continue
          const f = layout.get(fk)!
          const t = layout.get(tk)!
          const x0 = f.x + f.w / 2
          const x1 = t.x + t.w / 2
          const lift = Math.min(160, 30 + Math.abs(x1 - x0) * 0.12)
          let y0 = f.y + (f.label?.y ?? 0)
          let y1 = t.y + (t.label?.y ?? 0)
          let up = -lift
          // No room above (top row): leave from the bottom edges and curve below instead.
          if (Math.min(y0, y1) - lift * 0.75 < 4) {
            y0 = f.y + f.h
            y1 = t.y + t.h
            up = lift
          }
          set(`arc:${a.id}`, `M${x0} ${y0} C${x0} ${y0 + up} ${x1} ${y1 + up} ${x1} ${y1}`)
        }
        for (const l of itemLines(model, layout, suggestions)) {
          beads.current.get(l.actionItemId)?.setAttribute('transform', `translate(${l.bead.x} ${l.bead.y})`)
          set(`commit:${l.actionItemId}`, l.end.kind === 'commit' ? l.end.path : null)
          set(`stub:${l.actionItemId}`, l.end.kind === 'open' ? l.end.path : null)
          const mk = marks.current.get(l.actionItemId)
          if (mk) {
            if (l.end.kind === 'open') mk.setAttribute('transform', `translate(${l.end.mark.x} ${l.end.mark.y})`)
            mk.style.display = l.end.kind === 'open' ? '' : 'none'
          }
        }
      },
    }),
    [model, ids, copyIds, arcs, suggestions],
  )

  const reg = (key: string) => (el: SVGPathElement | null) => {
    if (el) paths.current.set(key, el)
    else paths.current.delete(key)
  }
  const cls = (themeId: string) => (litThemes === null ? '' : litThemes.has(themeId) ? ' lit' : ' unlit')

  // Hover reports the pointer; keyboard focus reports the middle of the connector.
  const hover = (c: Connector) => ({
    onPointerEnter: (e: PointerEvent<SVGElement>) => {
      const r = svg.current!.getBoundingClientRect()
      const at = { x: e.clientX - r.left, y: e.clientY - r.top }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => onEnter(c, at), HOVER_MS)
    },
    onPointerLeave: () => {
      clearTimeout(timer.current)
      onLeave()
    },
    onFocus: (e: FocusEvent<SVGElement>) => {
      const el = e.currentTarget
      let at: Pt
      if (el instanceof SVGPathElement && el.getAttribute('d')) {
        const p = el.getPointAtLength(el.getTotalLength() / 2)
        at = { x: p.x, y: p.y }
      } else {
        const t = el.getAttribute('transform')?.match(/translate\(([-\d.]+) ([-\d.]+)\)/)
        at = { x: Number(t?.[1] ?? 0), y: Number(t?.[2] ?? 0) }
      }
      onEnter(c, at)
    },
    onBlur: onLeave,
    tabIndex: 0,
    role: 'button',
    'aria-label': labelFor(c),
  })
  const activate = (fn: () => void) => ({
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      fn()
    },
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fn()
      }
    },
  })

  return (
    <svg ref={svg} className={`threads${litThemes ? ' has-focus' : ''}`} width={width} height={height}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="arrow-head" />
        </marker>
        <marker id="arrow-focus" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="arrow-head focus" />
        </marker>
        <marker id="end-circle" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
          <circle cx="5" cy="5" r="3.5" className="end-circle" />
        </marker>
      </defs>
      {showCopyLinks &&
        copyIds.map((c) => (
          <g key={c.id}>
            <path ref={reg(`copy:${c.id}`)} className="copy-link" markerStart="url(#end-circle)" markerEnd="url(#end-circle)" />
            <path ref={reg(`hit:copy:${c.id}`)} className="hit" {...hover({ kind: 'copy', meetingId: c.meetingId })} />
          </g>
        ))}
      {ids.map((s) => (
        <path key={`case:${s.id}`} ref={reg(`case:${s.id}`)} className={`thread-case${cls(s.themeId)}`} />
      ))}
      {ids.map((s) => (
        <path key={s.id} ref={reg(s.id)} className={`thread${cls(s.themeId)}${hoverKey === s.id ? ' hovered' : ''}`} style={{ stroke: color(s.themeId) }} />
      ))}
      {ids.map((s) => (
        <path
          key={`hit:${s.id}`}
          ref={reg(`hit:${s.id}`)}
          className="hit thread-hit"
          {...hover({ kind: 'thread', themeId: s.themeId, from: s.from, to: s.to })}
          {...activate(() => onThemeClick(s.themeId))}
        />
      ))}
      {arcs.map((a) => (
        <g key={a.id}>
          <path
            ref={reg(`arc:${a.id}`)}
            className={`arc ${a.accepted ? 'arc-accepted' : 'arc-pending'}${a.focused ? ' arc-focus' : ''}${hoverKey === `arc:${a.id}` ? ' hovered' : ''}`}
            markerEnd={a.focused ? 'url(#arrow-focus)' : 'url(#arrow)'}
          />
          <path ref={reg(`hit:arc:${a.id}`)} className="hit" {...hover({ kind: 'arc', suggestionId: a.suggestionId, source: a.from })} />
        </g>
      ))}
      {model.actionItems
        .filter((a) => a.themeId)
        .map((a) => {
          const conn = { kind: 'bead' as const, actionItemId: a.id }
          return (
            <g key={a.id} className={`item${cls(a.themeId!)}${doneItems.has(a.id) ? ' done' : ''}`}>
              <path ref={reg(`commit:${a.id}`)} className="commit-line" markerEnd="url(#arrow)" />
              <path ref={reg(`hit:commit:${a.id}`)} className="hit" {...hover(conn)} tabIndex={-1} />
              <path ref={reg(`stub:${a.id}`)} className="open-stub" />
              <g
                ref={(el) => {
                  if (el) marks.current.set(a.id, el)
                  else marks.current.delete(a.id)
                }}
                className="open-mark"
                {...hover(conn)}
                tabIndex={-1}
              >
                <circle r="6" />
                <text textAnchor="middle" dy="3.2">?</text>
              </g>
              <g
                ref={(el) => {
                  if (el) beads.current.set(a.id, el)
                  else beads.current.delete(a.id)
                }}
                className="bead"
                {...hover(conn)}
                {...activate(() => onBeadClick(a.id))}
              >
                <circle r="9" className="bead-hit" />
                <circle r="4.5" style={{ fill: color(a.themeId!) }} />
              </g>
            </g>
          )
        })}
    </svg>
  )
})
