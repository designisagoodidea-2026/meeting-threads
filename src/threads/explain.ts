import type { Meeting, Model, Suggestion, Turn } from '../data/types'
import { itemCommitments } from './threads'

// Why a connector on the canvas exists, from the evidence (spec 006 data-model.md). The card and the
// connector's accessible label both read from this, so what is said and what is drawn can't drift apart.

export type Connector =
  | { kind: 'thread'; themeId: string; from: string; to: string }
  | { kind: 'arc'; suggestionId: string; source: string }
  | { kind: 'copy'; meetingId: string }
  | { kind: 'bead'; actionItemId: string }

export type Gap = 'hidden' | 'not-recorded' | 'upcoming' | 'no-mention'
export type End = { meetingId: string; quote: Turn | null; gap: Gap | null }

export type ConnectorExplanation = {
  kind: Connector['kind']
  headline: string
  themeId?: string // for `thread`
  ends?: [End, End]
  proposal?: {
    text: string
    targetMeetingId: string | null
    status: Suggestion['status']
    visibleTo: string[]
    sourceQuote: Turn | null
  }
  themes?: string[]
  item?: { actionItemId: string; ownerId: string; themeId: string | null; committedMeetingId: string | null; suggestedMeetingId: string | null }
}

const meetingOf = (model: Model, id: string): Meeting => {
  const m = model.meetingById.get(id)
  if (!m) throw new Error(`explainConnector: unknown meeting ${id}`)
  return m
}

// Gap reasons for a missing quote, in the order a reader would want them (research R5).
export function gapFor(m: Meeting): Gap | null {
  if (m.transcriptHidden) return 'hidden'
  if (m.upcoming) return 'upcoming'
  if (!m.transcript) return 'not-recorded'
  return null
}

export function explainConnector(model: Model, c: Connector, suggestions: Suggestion[]): ConnectorExplanation {
  if (c.kind === 'thread') {
    const theme = model.themes.find((t) => t.id === c.themeId)
    if (!theme) throw new Error(`explainConnector: unknown theme ${c.themeId}`)
    const end = (id: string): End => {
      const m = meetingOf(model, id)
      const gap = gapFor(m)
      if (gap) return { meetingId: id, quote: null, gap }
      const quote = m.transcript!.find((t) => theme.turnIds.includes(t.id)) ?? null
      return { meetingId: id, quote, gap: quote ? null : 'no-mention' }
    }
    return { kind: 'thread', headline: `${theme.name}, in both meetings`, themeId: theme.id, ends: [end(c.from), end(c.to)] }
  }

  if (c.kind === 'arc') {
    const s = suggestions.find((x) => x.id === c.suggestionId)
    if (!s) throw new Error(`explainConnector: unknown suggestion ${c.suggestionId}`)
    const src = meetingOf(model, c.source)
    const turnId = s.sources.find((x) => x.meetingId === c.source)?.turnId
    const target = s.targetMeetingId ? meetingOf(model, s.targetMeetingId) : null
    return {
      kind: 'arc',
      headline: !target ? `Needs its own meeting, from ${src.title}` : s.status === 'accepted' ? `On the agenda for ${target.title}, from ${src.title}` : `Suggested for ${target.title}, from ${src.title}`,
      proposal: {
        text: s.text,
        targetMeetingId: s.targetMeetingId,
        status: s.status,
        visibleTo: s.visibleTo,
        sourceQuote: src.transcript?.find((t) => t.id === turnId) ?? null,
      },
    }
  }

  if (c.kind === 'copy') {
    const m = meetingOf(model, c.meetingId)
    return { kind: 'copy', headline: `${m.title}, shown in each of its rows`, themes: [...m.themeIds] }
  }

  const a = model.actionItems.find((x) => x.id === c.actionItemId)
  if (!a) throw new Error(`explainConnector: unknown action item ${c.actionItemId}`)
  const { committed, suggested } = itemCommitments(model, suggestions).get(a.id)!
  const from = meetingOf(model, a.meetingId).title
  return {
    kind: 'bead',
    headline: committed
      ? `Action item from ${from}, on the agenda for ${meetingOf(model, committed).title}`
      : `Action item from ${from}, not yet committed to a meeting`,
    item: { actionItemId: a.id, ownerId: a.ownerId, themeId: a.themeId, committedMeetingId: committed, suggestedMeetingId: suggested },
  }
}
