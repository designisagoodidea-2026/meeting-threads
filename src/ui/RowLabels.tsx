import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Row } from '../layout/layouts'
import { Icon } from './Icon'

// Rows the lead can rename and reorder in place (spec 006 FR-035): projects, meeting types, themes.
export type RowEditing = {
  original: (id: string) => string // the name before any rename, shown as the placeholder
  onRename: (id: string, name: string) => void // '' restores the original
  onReorder: (ids: string[]) => void
}

type Props = {
  rows: Row[]
  editing: RowEditing | null // null for views whose rows aren't the lead's to edit (people)
  render: (r: Row, name: ReactNode) => ReactNode // the row's label, as the canvas draws it
}

// Rows keep their banded heights, so a column of them lines up with the canvas. Dragging swaps rows live
// here and the canvas follows on drop; Alt+↑/↓ moves a row from the keyboard.
export function RowLabels({ rows, editing, render }: Props) {
  const fixed = rows.filter((r) => r.key === 'none') // "No project" / "No theme" always stays last
  const movable = rows.filter((r) => r.key !== 'none')
  const ids = movable.map((r) => r.key)
  const [order, setOrder] = useState(ids)
  const latest = useRef(order)
  latest.current = order
  useEffect(() => setOrder(ids), [ids.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const byKey = new Map(movable.map((r) => [r.key, r]))

  if (!editing) return <>{rows.map((r) => <div key={r.key} className="row-item" style={{ height: r.h }}>{render(r, r.label)}</div>)}</>
  const move = (id: string, d: 1 | -1) => {
    const next = [...latest.current]
    const i = next.indexOf(id)
    if (i + d < 0 || i + d >= next.length) return
    next.splice(i, 1)
    next.splice(i + d, 0, id)
    editing.onReorder(next)
  }
  return (
    <>
      <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="row-group">
        {order.map((id) =>
          byKey.has(id) ? (
            <EditableRow key={id} row={byKey.get(id)!} editing={editing} render={render} onDrop={() => editing.onReorder(latest.current)} onMove={(d) => move(id, d)} />
          ) : null,
        )}
      </Reorder.Group>
      {fixed.map((r) => <div key={r.key} className="row-item" style={{ height: r.h }}>{render(r, r.label)}</div>)}
    </>
  )
}

function EditableRow({ row, editing, render, onDrop, onMove }: { row: Row; editing: RowEditing; render: Props['render']; onDrop: () => void; onMove: (d: 1 | -1) => void }) {
  const controls = useDragControls()
  const [renaming, setRenaming] = useState(false)
  const original = editing.original(row.key)
  const done = (value: string | null) => {
    setRenaming(false)
    if (value === null) return
    const v = value.trim()
    editing.onRename(row.key, v === original ? '' : v)
  }
  const name = renaming ? (
    <input
      className="row-rename"
      autoFocus
      defaultValue={row.label}
      placeholder={original}
      aria-label={`Rename ${row.label}`}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') done(e.currentTarget.value)
        if (e.key === 'Escape') {
          e.preventDefault() // keep the canvas's Escape from also clearing the selection
          done(null)
        }
      }}
      onBlur={(e) => renaming && done(e.currentTarget.value)}
    />
  ) : (
    <span onDoubleClick={() => setRenaming(true)}>{row.label}</span>
  )
  return (
    <Reorder.Item
      as="div"
      value={row.key}
      className="row-item editable"
      style={{ height: row.h }}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          onMove(e.key === 'ArrowUp' ? -1 : 1)
        }
      }}
    >
      <span className="row-handle" onPointerDown={(e) => controls.start(e)} title="Drag to reorder" aria-hidden="true">
        <svg viewBox="0 0 8 14" width="8" height="14"><g fill="currentColor">{[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="2" cy={y} r="1.1" />, <circle key={`b${y}`} cx="6" cy={y} r="1.1" />])}</g></svg>
      </span>
      {render(row, name)}
      {!renaming && (
        <button className="row-edit" onClick={() => setRenaming(true)} aria-label={`Rename ${row.label}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="Rename · Alt+↑/↓ to move">
          <Icon name="edit" size={12} />
        </button>
      )}
    </Reorder.Item>
  )
}
