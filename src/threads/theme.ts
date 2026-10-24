import type { ActionItem, Meeting, Model, Suggestion, Theme, Turn } from '../data/types'
import { gapFor, type Gap } from './explain'

export type ThemeSummary = {
  theme: Theme
  meetings: Meeting[]
  contributors: { personId: string | null; count: number }[] // null = unknown speakers, grouped
  mentions: { meetingId: string; turns: Turn[]; gap: Gap | null }[]
  actionItems: { item: ActionItem; status: 'open' | 'on-agenda' }[]
  suggestions: { pending: Suggestion[]; accepted: Suggestion[] }
}

// Everything known about one theme, for its page (spec 006 data-model.md, research R7). Reads the
// privacy-applied model: a hidden meeting stays listed but contributes no turns.
export function themeSummary(model: Model, themeId: string, suggestions: Suggestion[], doneItems: Set<string>): ThemeSummary {
  const theme = model.themes.find((t) => t.id === themeId)
  if (!theme) throw new Error(`themeSummary: unknown theme ${themeId}`)
  const mentions = theme.meetingIds.map((meetingId) => {
    const m = model.meetingById.get(meetingId)!
    const turns = (m.transcript ?? []).filter((t) => theme.turnIds.includes(t.id))
    return { meetingId, turns, gap: turns.length ? null : (gapFor(m) ?? 'no-mention') }
  })

  const counts = new Map<string | null, number>()
  for (const t of mentions.flatMap((x) => x.turns)) counts.set(t.speakerId, (counts.get(t.speakerId) ?? 0) + 1)
  const name = (id: string | null) => (id ? (model.people.get(id)?.name ?? id) : 'Unknown speaker')
  const contributors = [...counts]
    .map(([personId, count]) => ({ personId, count }))
    .sort((a, b) => b.count - a.count || name(a.personId).localeCompare(name(b.personId)))

  const items = model.actionItems.filter((a) => a.themeId === themeId)
  const onTheme = (s: Suggestion) =>
    s.id.endsWith(`:${themeId}`) || items.some((a) => s.id.endsWith(`:${a.topicKey}`) && s.sources.some((x) => x.turnId === a.sourceTurnId))
  const mine = suggestions.filter(onTheme)

  return {
    theme,
    meetings: theme.meetingIds.map((id) => model.meetingById.get(id)!),
    contributors,
    mentions,
    actionItems: items.map((item) => ({ item, status: doneItems.has(item.id) ? 'on-agenda' : 'open' })),
    suggestions: { pending: mine.filter((s) => s.status === 'pending'), accepted: mine.filter((s) => s.status === 'accepted') },
  }
}
