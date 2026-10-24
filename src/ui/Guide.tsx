import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// First-run tour (FR-031): three steps for someone opening the prototype cold. Non-modal, so the
// page stays usable; Skip or Done marks it seen, and the header's Tour button replays it.
export const GUIDE_STEPS = [
  {
    target: '.canvas',
    place: 'inside' as const,
    title: 'Two weeks of meetings, on one canvas',
    body: "This is a design ops lead's calendar, arranged by project. Lines join meetings that discussed the same theme; dots mark action items. The key at the bottom names every kind of line, and the buttons at the top rearrange the meetings by people, meeting type or theme. Drag a row label to reorder it, or use its pencil to rename it.",
  },
  {
    target: '.queue',
    place: 'left' as const,
    title: 'Follow-ups, suggested from what was said',
    body: 'The action queue collects agenda items drawn from earlier meetings, grouped by the meeting they would go to. Each one shows the quote behind it and the reason for that meeting.',
  },
  {
    target: '.queue .qi.focused',
    place: 'left' as const,
    title: 'Add one and watch it land',
    body: 'Each item shows the exact line it would add, to which meeting, and who will see it. “Add to …” puts it on that agenda, commits its action item and draws a solid line on the calendar. Undo is always there, in the queue, with U or ⌘Z. Keys: J and K move, A adds, D dismisses.',
  },
]

type Props = { step: number; onStep: (n: number) => void; onClose: () => void }

export function Guide({ step, onStep, onClose }: Props) {
  const s = GUIDE_STEPS[step]
  const [box, setBox] = useState<DOMRect | null>(null)
  const next = useRef<HTMLButtonElement>(null)
  // The target can appear a moment later (the queue opens for step 2), so look again briefly.
  useLayoutEffect(() => {
    let tries = 0
    let t: ReturnType<typeof setTimeout>
    const find = () => {
      const el = document.querySelector(s.target)
      if (el) setBox(el.getBoundingClientRect())
      else if (tries++ < 20) t = setTimeout(find, 50)
    }
    find()
    const settle = setTimeout(find, 450) // measure again once the queue has finished opening
    const onResize = () => find()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true) // the queue scrolls its item into view
    next.current?.focus()
    return () => {
      clearTimeout(t)
      clearTimeout(settle)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const W = 320
  const pos =
    !box ? { left: 16, top: 72 }
    : s.place === 'inside'
      ? { left: Math.max(16, box.left + box.width / 2 - W / 2), top: Math.max(16, box.top + box.height / 2 - 90) }
      : { left: Math.max(16, box.left - W - 16), top: Math.min(Math.max(16, box.top), innerHeight - 260) }
  const narrow = innerWidth < 760
  return (
    <>
      {box && <div className="guide-ring" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden="true" />}
      <motion.div
        key={step}
        className="guide"
        role="dialog"
        aria-label={`Tour, step ${step + 1} of ${GUIDE_STEPS.length}`}
        style={narrow ? { left: 16, right: 16, bottom: 16 } : { left: pos.left, top: pos.top, width: W }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <button className="pop-close" onClick={onClose} aria-label="Skip the tour"><Icon name="close" /></button>
        <div className="guide-count num">{step + 1} of {GUIDE_STEPS.length}</div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <div className="guide-actions">
          {step > 0 && <button className="btn" onClick={() => onStep(step - 1)}>Back</button>}
          <button className="btn skip" onClick={onClose}>Skip</button>
          {step < GUIDE_STEPS.length - 1 ? (
            <button ref={next} className="btn primary-btn" onClick={() => onStep(step + 1)}>Next</button>
          ) : (
            <button ref={next} className="btn primary-btn" onClick={onClose}>Done</button>
          )}
        </div>
      </motion.div>
    </>
  )
}
