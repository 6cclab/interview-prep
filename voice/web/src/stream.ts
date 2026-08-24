import type { DebugVerdict, DrillVerdict, Entry } from './types'

/**
 * The session stream: one append-only record of a round.
 *
 * The structural centre of the 1a redesign. Before it, three things fought for
 * the same screen — a transcript column, a verdict panel under the toolbar, and
 * a hint counter — and two of them were *insertions*, so a failing suite or a
 * recovery banner shoved the problem pane and the editor during a timed drill.
 * Everything that used to appear above the fold now appends to the bottom of one
 * chronological container, and nothing the round produces can move what is
 * already on screen.
 *
 * The ordering is the whole job of this module, which is why it is pure: given
 * the same turns and events it must always produce the same reading order, and
 * that is testable without a DOM.
 */

/** Where a stream entry's `at` comes from: milliseconds since the session began, matching `Entry.at`. */
export type StreamEntry =
  /** A turn, either voice. Both speakers are kept — the candidate's own words are half the record. */
  | { kind: 'speech'; at: number; speaker: Entry['speaker']; text: string }
  /**
   * A suite run. Carries the whole verdict rather than a summary, because the
   * three kinds are rendered differently on purpose and flattening them here
   * would put that decision somewhere it cannot be seen.
   */
  | { kind: 'verdict'; at: number; verdict: DrillVerdict }
  /** A debugging suite run. Separate kind: its verdicts have their own taxonomy. */
  | { kind: 'debug-verdict'; at: number; verdict: DebugVerdict }
  /**
   * A rung spent. Recorded as an event in its own right rather than derived
   * from the counter, because *when* help was taken is the fact the drill log
   * cares about and a bare count cannot answer it.
   */
  | { kind: 'hint'; at: number; rung: number }

/**
 * What the session hook accumulates alongside its turns.
 *
 * Verdicts and hints were previously a single "last verdict" slot and an
 * integer. Neither could be placed in time, so neither could join a
 * chronological record — hence a real event list.
 */
export type StreamEvent =
  | { kind: 'verdict'; at: number; verdict: DrillVerdict }
  | { kind: 'debug-verdict'; at: number; verdict: DebugVerdict }
  | { kind: 'hint'; at: number; rung: number }

/**
 * Turns and events merged into one reading order.
 *
 * Sorted by `at`, and **stably**: a verdict recorded in the same millisecond as
 * the turn that prompted it keeps the order the two arrived in rather than
 * flipping on a re-render. `Array.prototype.sort` has been stable since ES2019,
 * so this relies on the language rather than on a tiebreak field that would have
 * to be invented and kept correct.
 *
 * Turns come first in the concatenation for the same reason: when a test run and
 * the interviewer's reaction to it share a timestamp, the thing that was said
 * reads before the thing that was measured, which is the order they happened in
 * from the candidate's side.
 */
export function buildStream(entries: Entry[], events: StreamEvent[]): StreamEntry[] {
  const speech: StreamEntry[] = entries.map((entry) => ({
    kind: 'speech',
    at: entry.at,
    speaker: entry.speaker,
    text: entry.text,
  }))
  return [...speech, ...events].sort((a, b) => a.at - b.at)
}

/**
 * The index of the entry to render as live, or `-1`.
 *
 * Only the most recent *interviewer* turn is live: the design gives that one
 * entry `--foreground` at 15px while everything above it sits at
 * `--muted-foreground`, which is what makes a wall of prose readable as a
 * conversation with a current position in it. A verdict is never live — it is a
 * measurement that already happened, and brightening it would give the loudest
 * treatment on screen to the thing the candidate least needs to re-read.
 */
export function liveIndex(stream: StreamEntry[]): number {
  for (let i = stream.length - 1; i >= 0; i--) {
    const entry = stream[i]!
    if (entry.kind === 'speech' && entry.speaker === 'interviewer') return i
  }
  return -1
}
