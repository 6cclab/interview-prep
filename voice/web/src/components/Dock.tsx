import { Button } from 'brutalkit/button'
import type { Phase } from '../types'
import { PrimaryAction } from './PrimaryAction'

interface Props {
  phase: Phase
  statusTitle: string
  statusDetail: string
  onEndSession(): void
  onPrimary(): void
  /** The session POST is open. Straddles two phases — see PrimaryAction. */
  starting?: boolean
  /**
   * Seconds into the current answer, or null when nobody is speaking.
   *
   * Drives the waveform, which replaced the pacing bar that used to occupy its
   * own row above the dock. That row was another insertion: it appeared when
   * recording started and pushed the whole screen up at the exact moment the
   * candidate began talking. The bars live inside the dock's fixed 76px now, so
   * a turn beginning moves nothing.
   */
  elapsedSeconds?: number | null
}

/**
 * Eight bars, a deterministic shape per second.
 *
 * Not a real level meter: the audio never reaches this component, and faking
 * amplitude from a timer would be a lie about the microphone. What it honestly
 * signals is that time is passing while a turn is open, which is the same thing
 * the pacing bar signalled. `Math.random` is avoided deliberately — a shape that
 * changes on every unrelated re-render reads as noise rather than as a clock.
 */
function waveHeights(seconds: number): number[] {
  return Array.from({ length: 8 }, (_, i) => 5 + ((seconds * 3 + i * 5) % 4) * 4)
}

// Bottom dock, always visible: status block on the left, "End session" +
// the primary action on the right. The detail line is the slot that must
// absorb a full paragraph (the hung-permission copy) without shifting
// anything else — see the `max-width`/wrap rule in styles.css rather than
// any JS truncation here.
export function Dock({
  phase,
  statusTitle,
  statusDetail,
  onEndSession,
  onPrimary,
  starting,
  elapsedSeconds = null,
}: Props) {
  const canEndSession = phase !== 'idle' && phase !== 'ended'
  // The dot is the moment's colour; CSS owns which, keyed off `data-moment` on
  // the root, so this only has to be present.
  const speaking = phase === 'recording' || phase === 'speaking'

  return (
    <div className="drill-dock">
      <span className="drill-dot" aria-hidden="true" />
      <div className="dock__status">
        <div className="dock__status-row">
          <span className="dock__title">{statusTitle}</span>
        </div>
      </div>

      {/* The sentence gets its own 520px slot rather than sharing the 190px
          status block: it is a full paragraph in the hung-permission case, and
          wrapping that into the narrow column pushed it out of the 76px row. */}
      <p className="drill-dock-copy">{statusDetail}</p>

      <div className="drill-wave" data-speaking={speaking ? '' : undefined} aria-hidden="true">
        {waveHeights(elapsedSeconds ?? 0).map((h, i) => (
          <span key={i} style={{ height: `${h}px` }} />
        ))}
      </div>

      <span className="drill-dock-spacer" />

      {canEndSession && (
        <Button variant="outline" onClick={onEndSession}>
          End session
        </Button>
      )}
      <PrimaryAction phase={phase} starting={starting} onPress={onPrimary} />
    </div>
  )
}
