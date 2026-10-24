import { useEffect, useState } from 'react'

// Motion's useReducedMotion reads the setting once; this follows it live, so turning on Reduce motion
// in system settings takes effect without a reload (FR-009).
const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
