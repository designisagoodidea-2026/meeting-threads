import { motion, Reorder, useDragControls } from 'motion/react'
import { useState } from 'react'
import { emptyCustom, type Custom } from '../data/custom'
import type { Model } from '../data/types'
import { Icon } from './Icon'

type Kind = keyof Custom['order']
type Props = {
  base: Model // before custom names and order, for the defaults
  model: Model // with them
  custom: Custom | undefined
  onChange: (c: Custom | undefined) => void
  onReset: () => void
  onClose: () => void
}

// Demo admin (spec 006 FR-034, FR-035): rename and reorder projects, meeting types and themes, and put
// everything back to a first visit. Reordering uses Motion's Reorder, already in the app, with Move up /
// Move down buttons as the keyboard path.
export function DemoPanel({ base, model, custom, onChange, onReset, onClose }: Props) {
  const [confirming, setConfirming] = useState(false)
  const c = custom ?? emptyCustom()
  const lists: { kind: Kind; title: string; ids: string[]; name: (id: string) => string; original: (id: string) => string }[] = [
    { kind: 'project', title: 'Projects', ids: model.projects.map((p) => p.id), name: (id) => c.labels.project[id] ?? '', original: (id) => base.projects.find((p) => p.id === id)!.name },
    { kind: 'type', title: 'Meeting types', ids: model.typeOrder, name: (id) => c.labels.type[id] ?? '', original: (id) => base.typeLabels[id as keyof Model['typeLabels']] },
    { kind: 'theme', title: 'Themes', ids: model.themes.map((t) => t.id), name: (id) => c.labels.theme[id] ?? '', original: (id) => base.themes.find((t) => t.id === id)!.name },
  ]
  const setOrder = (kind: Kind, ids: string[]) => onChange({ ...c, order: { ...c.order, [kind]: ids } })
  const setName = (kind: Kind, id: string, name: string) => {
    const labels = { ...c.labels[kind] }
    if (name) labels[id] = name
    else delete labels[id]
    onChange({ ...c, labels: { ...c.labels, [kind]: labels } })
  }
  return (
    <motion.div
      className="privacy demo"
      role="dialog"
      aria-label="Demo settings"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
    >
      <button className="pop-close" onClick={onClose} aria-label="Close demo settings"><Icon name="close" /></button>
      <h2>Demo settings</h2>
      <p className="privacy-where">Rename and reorder rows; the calendar, cards and pages follow. Drag the handle, or use the arrows. Leave a name blank to use the original.</p>
      <div className="demo-cols">
        {lists.map((l) => (
          <section key={l.kind}>
            <h3>{l.title}</h3>
            <Reorder.Group as="ol" axis="y" values={l.ids} onReorder={(ids: string[]) => setOrder(l.kind, ids)} className="demo-list">
              {l.ids.map((id, i) => (
                <DemoRow
                  key={id}
                  id={id}
                  value={l.name(id)}
                  original={l.original(id)}
                  first={i === 0}
                  last={i === l.ids.length - 1}
                  onRename={(v) => setName(l.kind, id, v)}
                  onMove={(d) => {
                    const ids = [...l.ids]
                    ids.splice(i, 1)
                    ids.splice(i + d, 0, id)
                    setOrder(l.kind, ids)
                  }}
                />
              ))}
            </Reorder.Group>
          </section>
        ))}
      </div>
      <div className="demo-reset">
        <button className="btn" disabled={!custom} onClick={() => onChange(undefined)}>Restore original names and order</button>
        {!confirming ? (
          <button className="btn danger" onClick={() => setConfirming(true)}>Reset all demo data…</button>
        ) : (
          <div className="demo-confirm" role="alert">
            <p>This clears your decisions, notes, privacy choices, imported transcripts, names and order, and shows the tour again.</p>
            <button className="btn danger" autoFocus onClick={onReset}>Reset everything</button>
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function DemoRow(props: { id: string; value: string; original: string; first: boolean; last: boolean; onRename: (v: string) => void; onMove: (d: 1 | -1) => void }) {
  const { id, value, original, first, last, onRename, onMove } = props
  const controls = useDragControls()
  return (
    <Reorder.Item as="li" value={id} dragListener={false} dragControls={controls} className="demo-row">
      <span className="demo-handle" onPointerDown={(e) => controls.start(e)} aria-hidden="true">⋮⋮</span>
      <input value={value} placeholder={original} aria-label={`Name for ${original}`} onChange={(e) => onRename(e.target.value)} />
      <button className="demo-move" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${value || original} up`}>↑</button>
      <button className="demo-move" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${value || original} down`}>↓</button>
    </Reorder.Item>
  )
}
