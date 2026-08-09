import type { Phase } from '../types'

interface Props {
  phase: Phase
  onPress(): void
}

// Same control starts the session, starts a turn, and ends a turn — one
// element, three appearances, per the handoff. This is deliberately a plain
// button styled directly over Brutalkit's tokens rather than Brutalkit's own
// `Button`: the handoff's reference markup renders this control the same
// way (hand-styled, not `x-import Brutalkit.Button`) because its size
// (250×76, two stacked lines) and always-on hard shadow don't match any
// `Button` size/variant, and `Button`'s hover/press motion (translate + a
// shadow that only appears on hover) isn't the "always-4px, press-to-2px"
// look this control needs. `Button` is used everywhere the handoff itself
// uses it — see Header.tsx, Dock.tsx, ErrorBanner.tsx.
export function PrimaryAction({ phase, onPress }: Props) {
  // Every phase where the drill is doing something and pressing would be wrong.
  // Rendered as a non-button so there is nothing to press: the transcribing case
  // used to leave a live "End answer" here for the several seconds transcription
  // takes, which invited a second press against an already-stopped recorder.
  const WAITING: Partial<Record<Phase, { label: string; hint: string }>> = {
    requesting: { label: 'Waiting for microphone', hint: 'Please wait' },
    transcribing: { label: 'Transcribing your answer', hint: 'Not recording' },
    thinking: { label: 'Interviewer is thinking', hint: 'Please wait' },
    speaking: { label: 'Interviewer speaking', hint: 'Please wait' },
  }

  const waiting = WAITING[phase]
  if (waiting) {
    return (
      <div className="primary primary--wait" aria-disabled="true" aria-busy="true">
        <span className="primary__label">{waiting.label}</span>
        <span className="primary__hint">{waiting.hint}</span>
      </div>
    )
  }

  const appearance = phase === 'recording' ? 'stop' : 'go'
  const label =
    phase === 'idle'
      ? 'Start session'
      : phase === 'ready'
        ? 'Start answer'
        : phase === 'recording'
          ? 'End answer'
          : 'Start new session' // ended

  return (
    <button type="button" className={`primary primary--${appearance}`} onClick={onPress}>
      <span className="primary__label">{label}</span>
      <span className="primary__hint">Space</span>
    </button>
  )
}
