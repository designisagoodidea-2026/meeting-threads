import { describe, expect, it } from 'vitest'
import { createStore, KEY } from '../src/store'

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]])
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('store', () => {
  it('starts empty and saves changes', () => {
    const mem = memory()
    const s = createStore(mem)
    expect(s.state.notes).toEqual([])
    s.update((st) => ({ ...st, privacy: { ...st.privacy, hiddenMeetingIds: ['m1'] } }))
    expect(JSON.parse(mem.data.get(KEY)!).privacy.hiddenMeetingIds).toEqual(['m1'])
    expect(createStore(mem).state.privacy.hiddenMeetingIds).toEqual(['m1'])
    expect(s.saved).toBe(true)
  })

  it('on bad JSON or an unknown version, starts empty with a banner and does not overwrite until a change', () => {
    for (const raw of ['{not json', JSON.stringify({ version: 9 })]) {
      const mem = memory(raw)
      const s = createStore(mem)
      expect(s.state.notes).toEqual([])
      expect(s.banner).toBeTruthy()
      expect(mem.data.get(KEY)).toBe(raw)
      s.update((st) => st)
      expect(JSON.parse(mem.data.get(KEY)!).version).toBe(1)
    }
  })

  it('works in memory when storage is missing or throws', () => {
    const s = createStore(null)
    expect(s.saved).toBe(false)
    s.update((st) => ({ ...st, notes: [{ id: 'n', personId: 'p', text: 't', updatedAt: 'x' }] }))
    expect(s.state.notes).toHaveLength(1)

    const throwing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    const t = createStore(throwing)
    expect(t.saved).toBe(true)
    t.update((st) => st)
    expect(t.saved).toBe(false)
  })
})
