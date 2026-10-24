import { forwardRef, memo } from 'react'
import type { Meeting, Model } from '../data/types'
import { TYPE_LABELS, type Item } from '../layout/layouts'
import { hm } from './format'
import { themeColor } from './theme-colors'


type Props = {
  model: Model
  meeting: Meeting
  item: Item | undefined // the settled target box, for people-pivot segments
  split: boolean // show attendee lanes (people pivot, settled)
  linked: boolean // another copy of this meeting is hovered (theme pivot)
  dimmed: boolean // something else is focused
  selected: boolean
  onHover: (meetingId: string | null) => void
  onSelect: (meetingId: string) => void
  onOpen: (meetingId: string) => void // Enter on an already-selected meeting opens its page
}

export const MeetingBlock = memo(
  forwardRef<HTMLDivElement, Props>(function MeetingBlock({ model, meeting, item, split, linked, dimmed, selected, onHover, onSelect, onOpen }, ref) {
    const tz = model.timeZone
    const time = `${hm(meeting.start, tz)}–${hm(meeting.end, tz)}`
    const others = meeting.attendeeIds.length - 1
    const label = `${meeting.title}, ${TYPE_LABELS[meeting.type]}, ${time}, ${others} ${others === 1 ? 'other person' : 'other people'}`
    const themes = meeting.themeIds.map((id) => model.themes.find((t) => t.id === id)!)
    const segments = split ? item?.segments : undefined
    return (
      <div
        ref={ref}
        className={`block${split ? ' split' : ''}${linked ? ' linked' : ''}${dimmed ? ' dimmed' : ''}${selected ? ' selected' : ''}`}
        data-type={meeting.type}
        data-meeting={meeting.id}
        title={meeting.transcriptHidden ? `${label}, transcript hidden` : label}
        aria-label={label}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(meeting.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (e.key === 'Enter' && selected) onOpen(meeting.id)
            else onSelect(meeting.id)
          }
        }}
        onPointerEnter={() => onHover(meeting.id)}
        onPointerLeave={() => onHover(null)}
      >
        <div className="shadow" />
        <div className="card">
          {themes.length > 0 && (
            <div className="dots">
              {themes.map((t) => (
                <i key={t.id} style={{ background: themeColor(t.color) }} title={t.name} />
              ))}
            </div>
          )}
        </div>
        {meeting.transcriptHidden && (
          <svg className="hidden-mark" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zm1 5L13 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
        {segments?.map((s, i) => (
          <div key={i} className={`seg ${s.on ? 'on' : 'off'}`} style={{ top: s.y, height: s.h }} />
        ))}
      </div>
    )
  }),
)
