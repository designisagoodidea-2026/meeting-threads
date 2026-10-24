import { describe, expect, it } from 'vitest'
import { deriveSuggestions } from '../src/threads/suggestions'
import { whySuggested } from '../src/threads/why'
import { model } from './fixtures'

describe('whySuggested', () => {
  const m = model()
  const all = deriveSuggestions(m, {})
  const themeIds = new Set(m.themes.map((t) => t.id))
  const topic = (id: string) => id.slice(id.indexOf(':') + 1)
  const first = (id: string) => m.people.get(id)!.name.split(' ')[0]

  it('quotes the turn behind every source', () => {
    for (const s of all) {
      const w = whySuggested(m, s)
      expect(w.quotes.map((q) => q.turn.id)).toEqual(s.sources.map((x) => x.turnId))
      for (const q of w.quotes) expect(q.meetingId).toBe(q.turn.meetingId)
    }
  })

  const PHRASE = { theme: /is the next meeting where .+ is on the table/, series: /next session of the same meeting/, 'one-on-one': /your next 1:1 with/ }

  it("names an action item's owner and states the reason its target was chosen", () => {
    for (const s of all.filter((x) => !themeIds.has(topic(x.id)) && x.targetMeetingId)) {
      const item = m.actionItems.find((a) => a.sourceTurnId === s.sources[0].turnId && a.topicKey === topic(s.id))!
      const reason = whySuggested(m, s).reason
      expect(reason).toContain(item.ownerId === m.leadId ? 'You' : first(item.ownerId))
      expect(reason).toContain(m.meetingById.get(s.targetMeetingId!)!.title)
      expect(reason).toMatch(PHRASE[s.basis!])
    }
  })

  it('names who raised a theme follow-up, and quotes someone who is in the target', () => {
    const themed = all.filter((x) => themeIds.has(topic(x.id)) && x.targetMeetingId)
    expect(themed.length).toBeGreaterThan(0)
    for (const s of themed) {
      const theme = m.themes.find((t) => t.id === topic(s.id))!
      const target = m.meetingById.get(s.targetMeetingId!)!
      const reason = whySuggested(m, s).reason
      expect(reason).toContain(`raised ${theme.name}`)
      expect(reason).toContain(target.title)
      expect(reason).toMatch(PHRASE[s.basis!])
      for (const q of whySuggested(m, s).quotes) expect(target.attendeeIds).toContain(q.turn.speakerId)
    }
  })

  it('says why there is no target', () => {
    for (const s of all.filter((x) => !x.targetMeetingId)) expect(whySuggested(m, s).reason).toMatch(/No later meeting puts .+ on the table.*Worth calling a short meeting/)
  })

  it('handles the merged retest suggestion with both sources', () => {
    const s = all.find((x) => x.id === 'evt_20261104_1000:retest-progress-meter')!
    const w = whySuggested(m, s)
    expect(w.quotes).toHaveLength(2)
    expect(w.reason).toContain('Priya')
    expect(w.reason).toContain('Hannah')
  })
})
