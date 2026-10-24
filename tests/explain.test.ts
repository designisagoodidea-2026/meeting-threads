import { describe, expect, it } from 'vitest'
import { applyPrivacy } from '../src/data/privacy'
import { computeLayout } from '../src/layout/layouts'
import { explainConnector } from '../src/threads/explain'
import { deriveSuggestions } from '../src/threads/suggestions'
import { threadSegments } from '../src/threads/threads'
import { model } from './fixtures'

const NONE = { hiddenMeetingIds: [], excludedPersonIds: [] }
const CRIT = 'evt_20261102_1100'

describe('explainConnector: threads', () => {
  const m = model()
  const sugs = deriveSuggestions(m, {})
  const segs = threadSegments(m, computeLayout(m, 'type', { dayWidth: 600, height: 700 }).items)

  it('quotes a turn from each end that mentions the theme, or names exactly one gap', () => {
    for (const s of segs) {
      const theme = m.themes.find((t) => t.id === s.themeId)!
      const e = explainConnector(m, { kind: 'thread', themeId: s.themeId, from: s.fromMeetingId, to: s.toMeetingId }, sugs)
      expect(e.headline).toContain(theme.name)
      expect(e.ends!.map((x) => x.meetingId)).toEqual([s.fromMeetingId, s.toMeetingId])
      for (const end of e.ends!) {
        if (end.quote) {
          expect(end.gap).toBeNull()
          expect(end.quote.meetingId).toBe(end.meetingId)
          expect(theme.turnIds).toContain(end.quote.id)
        } else {
          expect(['hidden', 'not-recorded', 'no-mention']).toContain(end.gap)
        }
      }
    }
  })

  it('says why an end has no quote', () => {
    const unrecorded = m.meetings.find((x) => !x.transcript && x.themeIds.length)!
    const useg = segs.find((s) => s.fromMeetingId === unrecorded.id || s.toMeetingId === unrecorded.id)!
    const e = explainConnector(m, { kind: 'thread', themeId: useg.themeId, from: useg.fromMeetingId, to: useg.toMeetingId }, sugs)
    expect(e.ends!.find((x) => x.meetingId === unrecorded.id)!.gap).toBe('not-recorded')

    const hidden = applyPrivacy(m, { ...NONE, hiddenMeetingIds: [CRIT] })
    const critSeg = segs.find((s) => s.fromMeetingId === CRIT && s.themeId === 'onboarding')!
    const h = explainConnector(hidden, { kind: 'thread', themeId: 'onboarding', from: CRIT, to: critSeg.toMeetingId }, deriveSuggestions(hidden, {}))
    expect(h.ends![0]).toMatchObject({ quote: null, gap: 'hidden' })

    // A recorded meeting tagged with the theme but with no turn about it (the calendar said so, nobody did).
    const quiet = model()
    const seg = segs.find((s) => quiet.meetingById.get(s.fromMeetingId)!.transcript)!
    const theme = quiet.themes.find((t) => t.id === seg.themeId)!
    theme.turnIds = theme.turnIds.filter((id) => !id.startsWith(`${seg.fromMeetingId}#`))
    const q = explainConnector(quiet, { kind: 'thread', themeId: seg.themeId, from: seg.fromMeetingId, to: seg.toMeetingId }, sugs)
    expect(q.ends![0]).toMatchObject({ quote: null, gap: 'no-mention' })
  })
})

describe('explainConnector: arcs, copies, beads', () => {
  const m = model()
  const sugs = deriveSuggestions(m, { 'evt_20261104_1000:retest-progress-meter': { status: 'accepted', at: 'x' } })

  it('explains an arc with its source quote, item, target, status and audience', () => {
    const s = sugs.find((x) => x.id === 'evt_20261104_1000:retest-progress-meter')!
    const e = explainConnector(m, { kind: 'arc', suggestionId: s.id, source: CRIT }, sugs)
    expect(e.proposal).toMatchObject({ text: s.text, targetMeetingId: s.targetMeetingId, status: 'accepted', visibleTo: s.visibleTo })
    expect(e.proposal!.sourceQuote!.id).toBe(s.sources.find((x) => x.meetingId === CRIT)!.turnId)
    expect(e.headline).toMatch(/on the agenda/i)
  })

  it('lists a copied meeting\'s themes', () => {
    const multi = m.meetings.find((x) => x.themeIds.length > 1)!
    const e = explainConnector(m, { kind: 'copy', meetingId: multi.id }, sugs)
    expect(e.themes).toEqual(multi.themeIds)
    expect(e.headline).toContain(multi.title)
  })

  it('names a bead\'s owner, theme and commitment', () => {
    const a = m.actionItems.find((x) => x.topicKey === 'stepper-audit')!
    const pending = sugs.find((s) => s.sources.some((x) => x.turnId === a.sourceTurnId) && s.id.endsWith(':stepper-audit'))!
    const e = explainConnector(m, { kind: 'bead', actionItemId: a.id }, sugs)
    expect(e.item).toEqual({ actionItemId: a.id, ownerId: a.ownerId, themeId: a.themeId, committedMeetingId: null, suggestedMeetingId: pending.targetMeetingId })
    expect(e.headline).toMatch(/not yet committed/i)

    const retest = m.actionItems.find((x) => x.sourceTurnId === sugs.find((s) => s.id === 'evt_20261104_1000:retest-progress-meter')!.sources[0].turnId)!
    const c = explainConnector(m, { kind: 'bead', actionItemId: retest.id }, sugs)
    expect(c.item!.committedMeetingId).toBe('evt_20261104_1000')
    expect(c.headline).toMatch(/agenda/i)
  })

  it('throws on an unknown id', () => {
    expect(() => explainConnector(m, { kind: 'copy', meetingId: 'nope' }, sugs)).toThrow()
    expect(() => explainConnector(m, { kind: 'arc', suggestionId: 'nope', source: CRIT }, sugs)).toThrow()
  })
})
