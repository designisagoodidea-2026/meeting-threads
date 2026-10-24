import { describe, expect, it } from 'vitest'
import { deriveSuggestions, isTopicOf } from '../src/threads/suggestions'
import { model } from './fixtures'

describe('deriveSuggestions', () => {
  const m = model()
  const all = deriveSuggestions(m, {})
  const startOf = (id: string) => +m.meetingById.get(id)!.start

  // Independent statement of the ranked rule (spec 005 research R5, revised): a target needs a strong reason.
  //  1. the next meeting where the theme is a real topic that one of the people attends;
  //  2. the next session of the same recurring meeting, with one of them in it;
  //  3. the lead's next 1:1 with one of them;
  //  otherwise no target ("needs its own meeting").
  const expected = (fromId: string, people: string[], themeId: string | null) => {
    const from = m.meetingById.get(fromId)!
    const later = m.meetings.filter((x) => +x.start > +from.start)
    const has = (x: (typeof later)[number]) => people.some((p) => x.attendeeIds.includes(p))
    const t1 = themeId ? later.find((x) => isTopicOf(m, x, themeId) && has(x)) : undefined
    if (t1) return { id: t1.id, basis: 'theme' }
    const t2 = later.find((x) => x.title === from.title && x.type === from.type && has(x))
    if (t2) return { id: t2.id, basis: 'series' }
    const t3 = later.find((x) => x.type === 'one-on-one' && people.some((p) => p !== m.leadId && x.attendeeIds.includes(p)))
    if (t3) return { id: t3.id, basis: 'one-on-one' }
    return { id: null, basis: null }
  }

  it('sends an action item where its topic, its meeting series, or a 1:1 with its owner gives a strong reason', () => {
    for (const a of m.actionItems) {
      const s = all.find((x) => x.sources.some((src) => src.turnId === a.sourceTurnId) && x.id.endsWith(`:${a.topicKey}`))!
      expect(s, a.id).toBeTruthy()
      const want = expected(a.meetingId, [a.ownerId], a.themeId)
      expect(s.targetMeetingId, a.text).toBe(want.id)
      expect(s.basis).toBe(want.basis)
    }
  })

  it('sends a theme follow-up by the same ranking, using the people who raised it', () => {
    const themed = all.filter((x) => m.themes.some((t) => x.id.endsWith(`:${t.id}`)))
    expect(themed.length).toBeGreaterThan(0)
    for (const s of themed) {
      const theme = m.themes.find((t) => s.id.endsWith(`:${t.id}`))!
      for (const src of s.sources) {
        const a = m.meetingById.get(src.meetingId)!
        expect(m.actionItems.some((x) => x.meetingId === a.id && x.themeId === theme.id)).toBe(false)
        const raisers = [...new Set(a.transcript!.filter((t) => theme.turnIds.includes(t.id) && t.speakerId && t.speakerId !== m.leadId).map((t) => t.speakerId!))]
        expect(s.targetMeetingId).toBe(expected(a.id, raisers, theme.id).id)
      }
    }
  })

  it('never sends a topic to a meeting with no reason to hear it', () => {
    for (const s of all.filter((x) => x.targetMeetingId)) {
      const t = m.meetingById.get(s.targetMeetingId!)!
      const topic = s.id.slice(s.id.indexOf(':') + 1)
      const themeId = m.themes.some((x) => x.id === topic) ? topic : m.actionItems.find((a) => a.topicKey === topic)?.themeId
      const series = s.sources.some((x) => m.meetingById.get(x.meetingId)!.title === t.title)
      expect(isTopicOf(m, t, themeId!) || series || t.type === 'one-on-one', `${s.text} -> ${t.title}`).toBe(true)
    }
  })

  it('treats a theme as a topic only when it is more than a passing remark', () => {
    const session = m.meetingById.get('evt_20261103_1400')! // Onboarding v3 working session: one remark about recruiting
    expect(session.themeIds).toContain('research-ops')
    expect(isTopicOf(m, session, 'research-ops')).toBe(false)
    expect(isTopicOf(m, session, 'onboarding')).toBe(true) // in its title
    const unrecorded = m.meetings.find((x) => !x.transcript && x.themeIds.length)!
    expect(isTopicOf(m, unrecorded, unrecorded.themeIds[0])).toBe(true)
  })

  it('sends the research repository taxonomy to the research ops sync, not an onboarding session', () => {
    const s = all.find((x) => x.id.endsWith(':repo-taxonomy') && x.sources.some((src) => src.meetingId === 'evt_20261102_0930'))!
    expect(m.meetingById.get(s.targetMeetingId!)!.title).toBe('Research ops sync')
    expect(s.basis).toBe('theme')
  })

  it('keeps the queue short enough to review in two minutes (SC-004)', () => {
    expect(all.filter((s) => s.targetMeetingId).length).toBeLessThanOrEqual(40)
  })

  it('merges sources that share a target and topic', () => {
    const retest = all.filter((s) => s.id.endsWith(':retest-progress-meter'))
    expect(retest).toHaveLength(1)
    expect(retest[0].sources).toHaveLength(2)
    expect(retest[0].targetMeetingId).toBe('evt_20261104_1000')
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
  })

  it('has no target, and no basis, when nothing gives a strong reason', () => {
    const s = all.find((x) => x.id.endsWith(':onboarding-launch-date'))!
    expect(s.targetMeetingId).toBeNull()
    expect(s.basis).toBeNull()
  })

  it('is visible to the target attendees other than the lead', () => {
    for (const s of all.filter((x) => x.targetMeetingId)) {
      const t = m.meetingById.get(s.targetMeetingId!)!
      expect(s.visibleTo.sort()).toEqual(t.attendeeIds.filter((p) => p !== m.leadId).sort())
    }
  })

  it('applies decisions, with edited text overriding the default', () => {
    const [a, b] = all
    const out = deriveSuggestions(m, {
      [a.id]: { status: 'accepted', text: 'Edited', at: 'x' },
      [b.id]: { status: 'dismissed', at: 'x' },
    })
    expect(out.find((s) => s.id === a.id)).toMatchObject({ status: 'accepted', text: 'Edited' })
    expect(out.find((s) => s.id === b.id)!.status).toBe('dismissed')
    expect(out.filter((s) => s.status === 'pending')).toHaveLength(all.length - 2)
  })

  it('creates nothing from a done action item', () => {
    const m2 = model()
    const a = m2.actionItems.find((x) => x.topicKey === 'stepper-audit')!
    a.status = 'done'
    const out = deriveSuggestions(m2, {})
    expect(out.some((s) => s.sources.some((src) => src.turnId === a.sourceTurnId) && s.id.endsWith(':stepper-audit'))).toBe(false)
  })
})
