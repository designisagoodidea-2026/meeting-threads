// The small visibility cue: where a piece of information came from and who could see it.
// Always an icon plus short text, never color alone (contracts/ui-state.md).

type CueProps =
  | { kind: 'quote'; speaker: string; meeting: string }
  | { kind: 'private' }
  | { kind: 'shared-on-accept'; names: string[] }
  | { kind: 'shared'; names: string[] }
  | { kind: 'hidden' }

const icons = {
  quote: 'M4 5h8v6H7l-3 2.5V5z',
  private: 'M5 7V5.5a3 3 0 0 1 6 0V7m-7 0h8v6H4z',
  'shared-on-accept': 'M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm5 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13m-.5-2.5A3.5 3.5 0 0 1 14 13',
  hidden: 'M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zm1 5L13 3',
  shared: 'M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm5 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13m-.5-2.5A3.5 3.5 0 0 1 14 13',
}

export function Cue(props: CueProps) {
  const text =
    props.kind === 'quote'
      ? `${props.speaker}, ${props.meeting}`
      : props.kind === 'private'
        ? 'Only you'
        : props.kind === 'shared-on-accept'
          ? `Visible to ${props.names.join(', ')} if accepted`
          : props.kind === 'shared'
            ? `Visible to ${props.names.join(', ')}`
            : 'Transcript hidden'
  return (
    <span className={`cue cue-${props.kind}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d={icons[props.kind]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {text}
    </span>
  )
}

export function DeviceIndicator({ saved }: { saved: boolean }) {
  return (
    <span className={`device ${saved ? '' : 'device-unsaved'}`} title="Calendar, transcripts, notes and decisions never leave this browser.">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path d={icons.private} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {saved ? 'Stored on this device only' : 'Not saved'}
    </span>
  )
}
