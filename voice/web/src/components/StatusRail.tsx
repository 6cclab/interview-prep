import { Button } from 'brutalkit/button'
import type { RailState } from '../types'

/**
 * The always-present 28px rail under the header.
 *
 * The single most important structural idea in the redesign, and it is a
 * negative one: the rail is *always* in the layout, so a banner recolours it in
 * place and nothing below it moves. Before this, a failed transcription and a
 * save conflict each inserted a box mid-drill and shoved the problem pane and
 * the editor down the screen — during a timed round, at the exact moment the
 * candidate least wants the page to move.
 *
 * Idle it is quiet metadata about the file. It is never empty, because an empty
 * rail would collapse and reintroduce the movement it exists to prevent.
 */

interface Props {
  state: RailState
  /** Idle copy: what the editor is and when the file last saved. */
  idleText: string
  onRetryTranscription?: () => void
  onDismissTranscription?: () => void
  onOverwrite?: () => void
  onReload?: () => void
}

export function StatusRail({
  state,
  idleText,
  onRetryTranscription,
  onDismissTranscription,
  onOverwrite,
  onReload,
}: Props) {
  return (
    <div
      className="drill-rail"
      data-state={state === 'idle' ? undefined : state}
      // Only the two failure states announce. The idle rail changes whenever a
      // save lands, and a live region that reads "solution.ts written 3s ago"
      // every few seconds would make a screen reader useless for the duration
      // of a forty-five minute drill.
      role={state === 'idle' ? undefined : 'alert'}
    >
      {state === 'idle' && <span>{idleText}</span>}

      {state === 'transcription-failed' && (
        <>
          <span>Transcription failed — the last answer did not reach the interviewer</span>
          {onRetryTranscription && (
            <Button type="button" variant="outline" size="sm" className="drill-rail-btn" onClick={onRetryTranscription}>
              Say it again
            </Button>
          )}
          {onDismissTranscription && (
            <Button type="button" variant="outline" size="sm" className="drill-rail-btn" onClick={onDismissTranscription}>
              Dismiss
            </Button>
          )}
        </>
      )}

      {state === 'save-conflict' && (
        <>
          {/* Red is right here in a way it is not for a slow answer: something
              is genuinely wrong with the file. The two choices keep their
              existing wording — one of them is the only way out, so neither is
              optional decoration. */}
          <span>solution.ts changed on disk — your typed code is kept, autosave paused</span>
          {onOverwrite && (
            <Button type="button" variant="outline" size="sm" className="drill-rail-btn" onClick={onOverwrite}>
              Overwrite with what&rsquo;s on screen
            </Button>
          )}
          {onReload && (
            <Button type="button" variant="outline" size="sm" className="drill-rail-btn" onClick={onReload}>
              Discard and reload the file
            </Button>
          )}
        </>
      )}
    </div>
  )
}
