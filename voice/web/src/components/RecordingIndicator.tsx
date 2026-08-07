import type { Mode } from '../types'

interface Props {
  mode: Mode
  interviewerSpeaking: boolean
}

type Visual = 'idle' | 'speaking' | 'recording' | 'ended'

const LABEL: Record<Visual, string> = {
  idle: 'Ready',
  speaking: 'Interviewer',
  recording: 'Recording',
  ended: 'Ended',
}

const ARIA_LABEL: Record<Visual, string> = {
  idle: 'Idle. Microphone is off.',
  speaking: 'The interviewer is speaking. Microphone is off.',
  recording: 'Microphone is live. You are being recorded.',
  ended: 'The session has ended.',
}

function visualFor(mode: Mode, interviewerSpeaking: boolean): Visual {
  if (mode === 'recording') return 'recording'
  if (mode === 'ended') return 'ended'
  if (mode === 'listening-to-interviewer' && interviewerSpeaking) return 'speaking'
  return 'idle'
}

// The single most important state in the app: whether the mic is live. This
// has to read correctly from across a room, in peripheral vision, without
// looking directly at the screen — hence a large animated ring rather than a
// small icon, plus the `<body>`-level accent bar in App.tsx as a second,
// redundant signal. `role="img"` collapses the decorative ring/dot markup to
// one accessible name; the underlying mode is announced separately by the
// status paragraph's `aria-live` region.
export function RecordingIndicator({ mode, interviewerSpeaking }: Props) {
  const visual = visualFor(mode, interviewerSpeaking)
  return (
    <div className={`indicator indicator--${visual}`} role="img" aria-label={ARIA_LABEL[visual]}>
      <span className="indicator__ring" aria-hidden="true" />
      <span className="indicator__ring indicator__ring--outer" aria-hidden="true" />
      <span className="indicator__dot" aria-hidden="true" />
      <span className="indicator__label" aria-hidden="true">
        {LABEL[visual]}
      </span>
    </div>
  )
}
