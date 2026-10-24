import type { MeetingType, Model } from './types'

// The lead's names and order for projects, themes and meeting types (spec 006 FR-035). Stored by id,
// applied to the model, so every view, card and page picks them up with no other changes.
type Kind = 'project' | 'theme' | 'type'
// People can be reordered but never renamed (FR-044); older saved settings have no person order.
export type Custom = { labels: Record<Kind, Record<string, string>>; order: Record<Kind, string[]> & { person?: string[] } }

export const emptyCustom = (): Custom => ({ labels: { project: {}, theme: {}, type: {} }, order: { project: [], theme: [], type: [], person: [] } })

// Saved order first (unknown ids dropped), then anything not in it, in its original order.
export function ordered<T>(items: T[], id: (x: T) => string, saved: string[]): T[] {
  const rank = new Map(saved.map((x, i) => [x, i]))
  return items
    .map((x, i) => ({ x, i, r: rank.get(id(x)) ?? saved.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((e) => e.x)
}
const named = (name: string, custom: string | undefined) => (custom?.trim() ? custom.trim() : name)

export function applyCustom(model: Model, custom: Custom | undefined): Model {
  if (!custom) return model
  const { labels, order } = custom
  return {
    ...model,
    projects: ordered(model.projects, (p) => p.id, order.project).map((p) => ({ ...p, name: named(p.name, labels.project[p.id]) })),
    themes: ordered(model.themes, (t) => t.id, order.theme).map((t) => ({ ...t, name: named(t.name, labels.theme[t.id]) })),
    typeOrder: ordered(model.typeOrder, (t) => t, order.type),
    personOrder: order.person?.length ? order.person : undefined,
    typeLabels: Object.fromEntries(Object.entries(model.typeLabels).map(([k, v]) => [k, named(v, labels.type[k])])) as Record<MeetingType, string>,
  }
}
