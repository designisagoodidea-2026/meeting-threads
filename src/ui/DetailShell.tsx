import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Model } from '../data/types'
import { useReducedMotion } from './reduced-motion'

type Rect = { left: number; top: number; width: number; height: number }
type Ghost = { meetingId: string; type: string; from: Rect; to: Rect }

const FLY_S = 0.6

// The visible calendar block for a meeting, if any. The canvas stays mounted under every detail page,
// so the same lookup works on the way in and on the way back out.
export function blockRect(meetingId: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`.block[data-meeting="${meetingId}"]`)
  const sc = document.querySelector<HTMLElement>('.scroller')
  if (!el || !sc) return null
  const r = el.getBoundingClientRect()
  const v = sc.getBoundingClientRect()
  if (r.right < v.left || r.left > v.right) return null
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export type ShellApi = {
  // Spread onto a chip element to make it a fly target for that meeting's calendar block.
  chip: (meetingId: string) => { ref: (el: HTMLElement | null) => void; style: CSSProperties }
  leave: () => void
}

type Props = {
  model: Model
  label: string
  className: string
  fromPage: boolean // opened from another detail page: crossfade, nothing to fly from (research R2)
  onClose: () => void
  children: (api: ShellApi) => ReactNode
}

// Shared frame for the person, meeting and theme pages (spec 006 research R1): fly-in from the
// calendar, fly-out back to it, Escape and back. The canvas never unmounts, so its pivot, focus and
// scroll are simply still there on return.
export function DetailShell({ model, label, className, fromPage, onClose, children }: Props) {
  const reduced = useReducedMotion()
  const chips = useRef(new Map<string, HTMLElement>())
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [landed, setLanded] = useState(reduced || fromPage)
  const [leaving, setLeaving] = useState(false)

  useLayoutEffect(() => {
    if (reduced || fromPage) return
    const gs: Ghost[] = []
    for (const [meetingId, chip] of chips.current) {
      const from = blockRect(meetingId) // off-screen blocks have none, so their chips just fade in (FR-023)
      if (from) gs.push({ meetingId, type: model.meetingById.get(meetingId)!.type, from, to: rectOf(chip) })
    }
    setGhosts(gs)
    const t = setTimeout(() => {
      setLanded(true)
      setGhosts([])
    }, FLY_S * 1000 + 120)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (leaving) return
    setLeaving(true)
    if (reduced) return onClose()
    const gs: Ghost[] = []
    for (const [meetingId, chip] of chips.current) {
      const to = blockRect(meetingId)
      if (to) gs.push({ meetingId, type: model.meetingById.get(meetingId)!.type, from: rectOf(chip), to })
    }
    setLanded(false)
    setGhosts(gs)
    setTimeout(onClose, FLY_S * 1000)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault() // keeps the calendar's focus as it was
        leave()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  })

  const chip: ShellApi['chip'] = (meetingId) => ({
    ref: (el) => {
      if (el) chips.current.set(meetingId, el)
      else chips.current.delete(meetingId)
    },
    style: { visibility: landed ? 'visible' : 'hidden' },
  })

  return (
    <>
      <motion.section
        className={`detail ${className}`}
        aria-label={label}
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1, transition: { duration: leaving ? FLY_S * 0.8 : fromPage ? 0.2 : 0.3 } }}
      >
        {children({ chip, leave })}
      </motion.section>
      <div className="ghosts" aria-hidden="true">
        {ghosts.map((g, i) => (
          <motion.div
            key={`${g.meetingId}-${leaving}`}
            className="ghost"
            data-type={g.type}
            initial={g.from}
            animate={{ ...g.to, transition: { duration: FLY_S, delay: Math.min(i * 0.025, 0.2), ease: [0.65, 0, 0.35, 1] } }}
          />
        ))}
      </div>
    </>
  )
}
