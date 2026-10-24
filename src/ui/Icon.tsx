// The few drawn icons the UI needs, in one stroke weight (craft floor: no text glyphs standing in for icons).
const PATHS = {
  close: 'M4.5 4.5l7 7m0-7l-7 7',
  back: 'M10 3.5L5.5 8l4.5 4.5',
  check: 'M3.5 8.5l3 3 6-7',
  elbow: 'M4 2.5v5.5h8m-2.5-2.5L12 8l-2.5 2.5',
} as const

export function Icon({ name, size = 14 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="icon">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
