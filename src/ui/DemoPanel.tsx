import { motion } from 'motion/react'
import { useState } from 'react'
import { Icon } from './Icon'

type Props = {
  customized: boolean // any names or order changed
  onRestore: () => void
  onReset: () => void
  onClose: () => void
}

// Demo admin (spec 006 FR-034): put names and order back, or everything back to a first visit.
// Renaming and reordering themselves happen on the canvas's row labels (FR-035).
export function DemoPanel({ customized, onRestore, onReset, onClose }: Props) {
  const [confirming, setConfirming] = useState(false)
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
      <p className="privacy-where">For trying the prototype out. Rename or reorder rows on the calendar itself: drag a row's grip, or use its pencil.</p>
      <div className="demo-reset">
        <button className="btn" disabled={!customized} onClick={onRestore}>Restore original names and order</button>
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
