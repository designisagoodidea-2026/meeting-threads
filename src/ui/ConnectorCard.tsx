import { useLayoutEffect, useRef, useState } from 'react'
import type { Model } from '../data/types'
import type { ConnectorExplanation, End } from '../threads/explain'
import { SAMPLE_LABEL, Sample, type SampleKind } from './ConnectorKey'
import { Cue } from './Cue'
import { names, offset, speakerName, when } from './format'
import { themeColor } from './theme-colors'

const W = 320
const GAP_TEXT = { hidden: 'Transcript hidden', 'not-recorded': 'Not recorded', upcoming: 'Hasn’t happened yet', 'no-mention': 'No quotes on record about this theme' }

type Props = {
  model: Model
  explanation: ConnectorExplanation
  at: { x: number; y: number }
  // The visible part of the canvas body, in body coordinates, so the card never lands off-screen (FR-008).
  view: { left: number; width: number; height: number }
}

export function ConnectorCard({ model, explanation: e, at, view }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(160)
  useLayoutEffect(() => setH(el.current?.offsetHeight ?? 160), [e])
  const left = Math.max(view.left + 8, Math.min(at.x + 14, view.left + view.width - W - 8))
  const top = at.y + 16 + h > view.height - 8 ? Math.max(8, at.y - h - 12) : at.y + 16
  const tz = model.timeZone
  const sample: SampleKind = e.kind === 'bead' ? (e.item!.committedMeetingId ? 'commit' : 'open') : e.kind
  const themeId = e.themeId ?? e.item?.themeId
  const tint = themeId ? themeColor(model.themes.find((t) => t.id === themeId)?.color) : undefined

  return (
    <div ref={el} className="conn-card" role="tooltip" style={{ left, top, width: W }}>
      <div className="conn-head">
        <Sample id={sample} color={tint} />
        <div className="conn-headline">
          <span className="visually-hidden">{SAMPLE_LABEL[sample]}: </span>
          {e.headline}
        </div>
      </div>

      {e.ends && (
        <div className="conn-ends">
          {e.ends.map((end, i) => (
            <EndRow key={i} model={model} end={end} />
          ))}
        </div>
      )}

      {e.proposal && (
        <div className="conn-proposal">
          {e.proposal.sourceQuote && (
            <blockquote>
              <p>“{e.proposal.sourceQuote.text}”</p>
              <Cue kind="quote" speaker={speakerName(model, e.proposal.sourceQuote.speakerId)} meeting={`at ${offset(e.proposal.sourceQuote.offsetMs)}`} />
            </blockquote>
          )}
          <div className="conn-item">
            <span className="conn-lead">{e.proposal.status === 'accepted' ? 'On the agenda' : 'Proposed'}</span> {e.proposal.text}
          </div>
          {e.proposal.targetMeetingId && (
            <div className="conn-meta">
              For {model.meetingById.get(e.proposal.targetMeetingId)!.title}, {when(model.meetingById.get(e.proposal.targetMeetingId)!, tz)}
            </div>
          )}
          {e.proposal.visibleTo.length > 0 &&
            (e.proposal.status === 'accepted' ? (
              <Cue kind="shared" names={names(model, e.proposal.visibleTo, 3)} />
            ) : (
              <Cue kind="shared-on-accept" names={names(model, e.proposal.visibleTo, 3)} />
            ))}
        </div>
      )}

      {e.themes && (
        <div className="conn-themes">
          {e.themes.map((id) => {
            const t = model.themes.find((x) => x.id === id)!
            return (
              <span key={id} className="conn-theme">
                <i style={{ background: themeColor(t.color) }} />
                {t.name}
              </span>
            )
          })}
        </div>
      )}

      {e.item && (
        <div className="conn-proposal">
          <div className="conn-item">{model.actionItems.find((a) => a.id === e.item!.actionItemId)!.text}</div>
          <div className="conn-meta">
            Owner: {speakerName(model, e.item.ownerId)}
            {e.item.themeId && ` · on ${model.themes.find((t) => t.id === e.item!.themeId)!.name}`}
          </div>
          {e.item.committedMeetingId ? (
            <div className="conn-commit">
              <span className="conn-lead">Committed.</span> On the agenda for {model.meetingById.get(e.item.committedMeetingId)!.title}, {when(model.meetingById.get(e.item.committedMeetingId)!, tz)}
            </div>
          ) : (
            <div className="conn-commit open">
              <span className="conn-lead">Not yet committed.</span>{' '}
              {e.item.suggestedMeetingId
                ? `Suggested for ${model.meetingById.get(e.item.suggestedMeetingId)!.title}, ${when(model.meetingById.get(e.item.suggestedMeetingId)!, tz)}. Only a suggestion until you add it.`
                : 'No meeting gives it a strong reason yet, so it needs its own.'}
            </div>
          )}
          <div className="conn-hint">Click the dot for the source quote</div>
        </div>
      )}
    </div>
  )
}

function EndRow({ model, end }: { model: Model; end: End }) {
  const m = model.meetingById.get(end.meetingId)!
  return (
    <div className="conn-end">
      <div className="conn-meta">
        <strong>{m.title}</strong> · {when(m, model.timeZone)}
      </div>
      {end.quote ? (
        <blockquote>
          <p>“{end.quote.text}”</p>
          <Cue kind="quote" speaker={speakerName(model, end.quote.speakerId)} meeting={`at ${offset(end.quote.offsetMs)}`} />
        </blockquote>
      ) : end.gap === 'hidden' ? (
        <Cue kind="hidden" />
      ) : (
        <div className="conn-gap">{GAP_TEXT[end.gap!]}</div>
      )}
    </div>
  )
}
