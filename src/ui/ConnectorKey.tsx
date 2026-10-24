import { useId } from 'react'

// The connector key (spec 006 FR-001, FR-006a). Samples use the same classes as the canvas, so the key
// can't drift from what is drawn; connector cards lead with the same sample instead of a text label.
export type SampleKind = 'thread' | 'arc' | 'copy' | 'commit' | 'open'

const KINDS: { id: SampleKind; label: string; meaning: string }[] = [
  { id: 'thread', label: 'Theme thread', meaning: 'These meetings discussed the same theme' },
  { id: 'arc', label: 'Suggestion', meaning: 'Something said here is proposed for that agenda' },
  { id: 'copy', label: 'Same meeting', meaning: 'One meeting, shown in each project or theme row it belongs to' },
  { id: 'commit', label: 'Action item, committed', meaning: "Raised here, and on that meeting's agenda" },
  { id: 'open', label: 'Not yet committed', meaning: 'Raised here, with no meeting committed to it yet' },
]
export const SAMPLE_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<SampleKind, string>

const TEAL = '#14a39a'

export function Sample({ id, color = TEAL }: { id: SampleKind; color?: string }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg width="34" height="16" viewBox="0 0 34 16" aria-hidden="true" className="key-sample">
      <defs>
        <marker id={`a${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="arrow-head" />
        </marker>
        <marker id={`c${uid}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5">
          <circle cx="5" cy="5" r="3.5" className="end-circle" />
        </marker>
      </defs>
      {id === 'thread' && <path d="M2 8 C12 8 22 8 32 8" className="thread" style={{ stroke: color, opacity: 0.95 }} />}
      {id === 'arc' && <path d="M3 14 C3 2 30 2 30 13" className="arc arc-pending" markerEnd={`url(#a${uid})`} />}
      {id === 'copy' && <path d="M5 8 L29 8" className="copy-link" markerStart={`url(#c${uid})`} markerEnd={`url(#c${uid})`} />}
      {id === 'commit' && (
        <>
          <path d="M9 12 C14 2 24 2 31 9" className="commit-line" markerEnd={`url(#a${uid})`} />
          <circle cx="5" cy="12" r="3.5" fill={color} stroke="var(--ink)" strokeWidth="1.5" />
        </>
      )}
      {id === 'open' && (
        <>
          <circle cx="5" cy="5" r="3.5" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
          <path d="M9 8 L19 13" className="open-stub" />
          <g className="open-mark" transform="translate(26 13)">
            <circle r="5.5" />
            <text textAnchor="middle" dy="3">?</text>
          </g>
        </>
      )}
    </svg>
  )
}

export function ConnectorKey() {
  return (
    <div className="key" role="list" aria-label="What the lines mean">
      <span className="legend-head">Lines</span>
      {KINDS.map((k) => (
        <span key={k.id} className="key-item" role="listitem" title={k.meaning}>
          <Sample id={k.id} />
          {k.label}
          <span className="visually-hidden">: {k.meaning}</span>
        </span>
      ))}
    </div>
  )
}
