import type { RelationshipNote } from './data/types'

// Persisted state, per specs/005-meeting-threads/contracts/ui-state.md.
export type Persisted = {
  version: 1
  notes: RelationshipNote[]
  decisions: Record<string, { status: 'accepted' | 'dismissed'; text?: string; at: string }>
  privacy: { hiddenMeetingIds: string[]; excludedPersonIds: string[] }
}

export const KEY = 'meeting-threads:v1'

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void }

const empty = (): Persisted => ({ version: 1, notes: [], decisions: {}, privacy: { hiddenMeetingIds: [], excludedPersonIds: [] } })

export function createStore(storage: StorageLike | null) {
  const store = {
    state: empty(),
    saved: storage !== null, // false = in-memory only, the header says "Not saved"
    banner: null as string | null,
    update(fn: (s: Persisted) => Persisted) {
      store.state = fn(store.state)
      if (!storage) return
      try {
        storage.setItem(KEY, JSON.stringify(store.state))
      } catch {
        store.saved = false
      }
    },
  }
  if (!storage) return store
  let raw: string | null = null
  try {
    raw = storage.getItem(KEY)
  } catch {
    store.saved = false
    return store
  }
  if (raw === null) return store
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) throw new Error(`unknown version ${parsed?.version}`)
    store.state = { ...empty(), ...parsed }
  } catch {
    // Keep the unreadable value until the lead changes something, so nothing is lost by just opening the app.
    store.banner = 'Saved notes and decisions could not be read. Starting fresh; nothing is overwritten until you make a change.'
  }
  return store
}

export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
