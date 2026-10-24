import type { ActionItem, Meeting, Model, Project, Suggestion, Theme } from '../data/types'
import { themeSummary } from './theme'

export type ProjectSummary = {
  project: Project
  themes: Theme[]
  meetings: Meeting[] // every meeting touching one of its themes, in time order
  people: { personId: string; count: number }[] // meetings attended, the lead left out, most first
  actionItems: { item: ActionItem; status: 'open' | 'on-agenda' }[]
  suggestions: { pending: Suggestion[]; accepted: Suggestion[] }
}

// Everything about one project, for its page (spec 006 FR-039): a project is a set of themes, so its
// record is the union of theirs.
export function projectSummary(model: Model, projectId: string, suggestions: Suggestion[], doneItems: Set<string>): ProjectSummary {
  const project = model.projects.find((p) => p.id === projectId)
  if (!project) throw new Error(`projectSummary: unknown project ${projectId}`)
  const themes = model.themes.filter((t) => project.themeIds.includes(t.id))
  const meetings = model.meetings.filter((m) => m.themeIds.some((t) => project.themeIds.includes(t)))
  const counts = new Map<string, number>()
  for (const m of meetings) for (const p of m.attendeeIds) if (p !== model.leadId) counts.set(p, (counts.get(p) ?? 0) + 1)
  const name = (id: string) => model.people.get(id)?.name ?? id
  const people = [...counts].map(([personId, count]) => ({ personId, count })).sort((a, b) => b.count - a.count || name(a.personId).localeCompare(name(b.personId)))

  const per = themes.map((t) => themeSummary(model, t.id, suggestions, doneItems))
  const once = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()]
  return {
    project,
    themes,
    meetings,
    people,
    actionItems: [...new Map(per.flatMap((s) => s.actionItems).map((a) => [a.item.id, a])).values()],
    suggestions: { pending: once(per.flatMap((s) => s.suggestions.pending)), accepted: once(per.flatMap((s) => s.suggestions.accepted)) },
  }
}
