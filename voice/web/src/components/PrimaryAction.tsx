import { Button } from 'brutalkit/button'
import type { Phase } from '../types'

interface Props {
  phase: Phase
  /**
   * The `POST /api/session` round trip is open.
   *
   * Not a `Phase`, because it straddles two of them: `start` is called from
   * `idle` *and* from `ended`, and the mode does not change until the response
   * lands. `App.tsx`'s handler already refuses a second press (the spacebar goes
   * through the same handler, so the guard has to live there) — but a refusal the
   * screen does not show is a button that looks live and does nothing, which is
   * the same complaint that produced `transcribing` and `thinking`.
   */
  starting?: boolean
  onPress(): void
}

/**
 * Same control starts the session, starts a turn, and ends a turn — one
 * element, three appearances.
 *
 * Brutalkit's `Button`, not a hand-styled element. This used to be the latter,
 * on the reasoning that the handoff's 250×76 two-line control matched no
 * `Button` size and its always-on hard shadow matched no variant. That
 * reasoning cost more than it bought: `851d267` deleted `.primary--go` and
 * `.primary--stop` during an unrelated refactor, and because the classes were
 * the component's own invention nothing connected them back to it. The button
 * rendered with no background at all — a black rectangle on a black dock —
 * and stayed that way for weeks. A variant that lives in the design system
 * cannot be deleted by a refactor of this app's stylesheet.
 *
 * `brand` and `destructive` are the same two tokens the deleted rules named,
 * now reached through the system that owns them rather than through CSS that
 * happens to agree.
 */
export function PrimaryAction({ phase, starting = false, onPress }: Props) {
  // Every phase where the drill is doing something and pressing would be wrong.
  // `disabled` rather than a non-button: the transcribing case used to leave a
  // live "End answer" here for the several seconds transcription takes, which
  // invited a second press against an already-stopped recorder.
  const WAITING: Partial<Record<Phase, string>> = {
    requesting: 'Waiting for microphone',
    transcribing: 'Transcribing your answer',
    thinking: 'Interviewer is thinking',
    speaking: 'Interviewer speaking',
  }

  const waiting = starting ? 'Starting session' : WAITING[phase]
  if (waiting) {
    return (
      <Button
        variant="outline"
        size="xl"
        disabled
        aria-busy="true"
        // An indeterminate progress bar, because there is no percentage to
        // report: the waits here are a permission prompt, a transcription and
        // a model generating, none of which expose progress. Disabled styling
        // alone reads as "broken", which is the wrong message — the drill is
        // working. This is the one thing `Button` has no variant for, so it is
        // added *to* the system's button rather than replacing it.
        className="primary-wait"
      >
        {waiting}
      </Button>
    )
  }

  const label =
    phase === 'idle'
      ? 'Start session'
      : phase === 'ready'
        ? 'Start answer'
        : phase === 'recording'
          ? 'End answer'
          : 'Start new session' // ended

  return (
    <Button variant={phase === 'recording' ? 'destructive' : 'brand'} size="xl" onClick={onPress}>
      {label}
    </Button>
  )
}
