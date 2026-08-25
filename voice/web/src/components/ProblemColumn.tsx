import type { ProblemTrack } from '../types'
import { ProblemPane } from './ProblemPane'

/**
 * `ProblemPane` in a column that owns its own width and its own scrolling.
 *
 * The pane was written for a full-width slot above a transcript: it caps itself
 * at `--measure`, centres on an auto margin, pads itself 28px, and scrolls its
 * body inside a 32vh cap. Every one of those is wrong inside a narrow column
 * that already has a width and already scrolls — the measure overflowed the
 * column and ran the statement under the editor, and the 32vh cap truncated the
 * constraints list mid-line while the page below it sat empty.
 *
 * Both screens that show a problem alongside an editor need the same four
 * undos, and both had written them out separately. They had already drifted:
 * the drill zeroed the pane's padding and its body's bottom padding, practice
 * did not, so the same pane sat 28px inset on one screen and flush on the
 * other for no reason anyone chose. They live here now, once, keyed off a class
 * this component emits — so a third screen gets them by using this rather than
 * by remembering to copy them.
 *
 * `className` is for what the *column* is, not what the pane is: the drill's is
 * a fixed 560px flex child with a border, practice's is a grid cell. Those
 * genuinely differ and stay with their screens.
 */
interface Props {
  problem: string
  track: ProblemTrack
  /** The screen's own column class — width, padding, borders. */
  className: string
}

export function ProblemColumn({ problem, track, className }: Props) {
  return (
    <div className={`problem-column ${className}`}>
      <ProblemPane problem={problem} track={track} />
    </div>
  )
}
