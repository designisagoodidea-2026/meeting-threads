import { describe, expect, it } from 'vitest'
import { computeLayout } from '../src/layout/layouts'
import { deriveSuggestions } from '../src/threads/suggestions'
import { copyLinks, itemCommitments, itemLines, strandY, threadSegments } from '../src/threads/threads'
import { model } from './fixtures'

const VP = { dayWidth: 600, height: 700 }

describe('threadSegments', () => {
  const m = model()
  for (const pivot of ['type', 'theme'] as const) {
    it(`joins each theme's meetings in time order (${pivot} pivot)`, () => {
      const segs = threadSegments(m, computeLayout(m, pivot, VP).items)
      for (const t of m.themes) {
        const mine = segs.filter((s) => s.themeId === t.id)
        expect(mine).toHaveLength(Math.max(0, t.meetingIds.length - 1))
        expect(mine.map((s) => [s.fromMeetingId, s.toMeetingId])).toEqual(t.meetingIds.slice(1).map((id, i) => [t.meetingIds[i], id]))
        for (const s of mine) expect(s.path).toMatch(/^M[\d.-]+ [\d.-]+ C/)
      }
    })
  }

  it('in the project pivot, runs each theme along every project row it belongs to', () => {
    const lay = computeLayout(m, 'project', VP).items
    const segs = threadSegments(m, lay)
    for (const p of m.projects)
      for (const tid of p.themeIds) {
        const t = m.themes.find((x) => x.id === tid)!
        const mine = segs.filter((s) => s.themeId === tid && s.row === p.id)
        expect(mine.map((s) => [s.fromMeetingId, s.toMeetingId])).toEqual(t.meetingIds.slice(1).map((id, i) => [t.meetingIds[i], id]))
        for (const s of mine) {
          expect(s.fromKey).toBe(`${s.fromMeetingId}#${p.id}`)
          expect(s.toKey).toBe(`${s.toMeetingId}#${p.id}`)
        }
      }
    expect(new Set(segs.map((s) => s.id)).size).toBe(segs.length)
  })

  it('draws nothing for a theme in a single meeting', () => {
    const segs = threadSegments(m, computeLayout(m, 'type', VP).items)
    expect(segs.filter((s) => s.themeId === 'a11y')).toHaveLength(0)
  })

  it('in the theme pivot, attaches each segment to the copy in that theme row', () => {
    const segs = threadSegments(m, computeLayout(m, 'theme', VP).items)
    for (const s of segs) {
      expect(s.fromKey).toBe(`${s.fromMeetingId}#${s.themeId}`)
      expect(s.toKey).toBe(`${s.toMeetingId}#${s.themeId}`)
    }
  })
})

describe('copyLinks', () => {
  it('links the copies of each meeting, copies minus one per meeting', () => {
    const m = model()
    const lay = computeLayout(m, 'theme', VP).items
    const want = m.meetings.reduce((n, x) => n + Math.max(0, x.themeIds.length - 1), 0)
    expect(copyLinks(lay)).toHaveLength(want)
    expect(copyLinks(computeLayout(m, 'type', VP).items)).toHaveLength(0)
  })
})

describe('itemLines', () => {
  const m = model()
  const lay = computeLayout(m, 'type', VP).items
  const RETEST = 'evt_20261104_1000:retest-progress-meter'

  it('puts each dot at the right edge of the meeting that raised it, at its theme strand', () => {
    const lines = itemLines(m, lay, deriveSuggestions(m, {}))
    expect(lines).toHaveLength(m.actionItems.filter((a) => a.themeId).length)
    for (const l of lines) {
      const a = m.actionItems.find((x) => x.id === l.actionItemId)!
      const src = lay.get(a.meetingId)!
      const ti = m.themes.findIndex((t) => t.id === a.themeId)
      expect(l.meetingId).toBe(a.meetingId)
      expect(l.bead.x).toBeGreaterThanOrEqual(src.x + src.w)
      expect(l.bead.x).toBeLessThan(src.x + src.w + 40)
      expect(l.bead.y).toBeCloseTo(strandY(src, ti, m.themes.length))
    }
  })

  it('ends uncommitted items in an open stub with a ? mark', () => {
    for (const l of itemLines(m, lay, deriveSuggestions(m, {}))) {
      expect(l.end.kind).toBe('open')
      if (l.end.kind === 'open') {
        expect(l.end.path).toMatch(/^M/)
        expect(l.end.mark.x).toBeGreaterThan(l.bead.x)
      }
    }
  })

  it('ends a committed item in a line to the meeting whose agenda it is on', () => {
    const sugs = deriveSuggestions(m, { [RETEST]: { status: 'accepted', at: 'x' } })
    const accepted = sugs.find((s) => s.id === RETEST)!
    const lines = itemLines(m, lay, sugs)
    const committed = lines.filter((l) => l.end.kind === 'commit')
    expect(committed.map((l) => m.actionItems.find((a) => a.id === l.actionItemId)!.sourceTurnId).sort()).toEqual(
      accepted.sources.map((x) => x.turnId).sort(),
    )
    for (const l of committed) expect(l.end.kind === 'commit' && l.end.meetingId).toBe(accepted.targetMeetingId)
    expect(lines.filter((l) => l.end.kind === 'open')).toHaveLength(lines.length - committed.length)
  })

  it('names the queue suggestion behind each action item, pending or accepted', () => {
    const sugs = deriveSuggestions(m, { [RETEST]: { status: 'accepted', at: 'x' } })
    const c = itemCommitments(m, sugs)
    for (const a of m.actionItems) {
      const mine = sugs.filter((s) => s.id.endsWith(`:${a.topicKey}`) && s.sources.some((x) => x.turnId === a.sourceTurnId) && s.status !== 'dismissed')
      expect(c.get(a.id)!.suggestionId).toBe((mine.find((s) => s.status === 'accepted') ?? mine[0])?.id ?? null)
    }
    expect(c.get(m.actionItems.find((a) => a.topicKey === 'retest-progress-meter')!.id)!.suggestionId).toBe(RETEST)
  })

  it('gives an action item with no theme no line', () => {
    const m2 = model()
    m2.actionItems[0].themeId = null
    expect(itemLines(m2, computeLayout(m2, 'type', VP).items, deriveSuggestions(m2, {}))).toHaveLength(m2.actionItems.length - 1)
  })
})
