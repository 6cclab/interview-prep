import type { Track } from './context'
import type { DrillLogRow, StoryLog } from './transcript'
import type { CoachedRow } from './coached'
import type { HistoryRow, HistorySummary } from './drill-log'
import type { SolutionFile, WriteOutcome } from './solution-file'

/**
 * What a finished drill leaves behind, and where it goes.
 *
 * Local mode writes Markdown into `local/`: a transcript file, a row in
 * `drill-log.md`, a row in `coached.md`, a block in `stories.md`. That record is
 * plain text on purpose — it is readable without this program, it diffs, and it
 * is the thing `/status` reads. Deployed mode cannot use it: there is one
 * `local/` and there are several people, and appending everyone's drills to one
 * shared file is not a smaller version of the right answer, it is the wrong one.
 *
 * So this is the seam. Same four writes, same one read, two implementations —
 * and, as with `ProblemSource`, chosen once at startup rather than per call.
 *
 * ---
 *
 * **Asynchronous, unlike `ProblemSource`, and for the opposite reason.** Problem
 * definitions are a fixed read-only set that a deployed instance loads once and
 * answers out of memory. This is the other kind of data entirely: it is written
 * during a drill, it is per person, and it must be durable before the client is
 * told the drill ended. There is nothing to cache and nothing to preload, so the
 * promise has to be real.
 */

/** Where a finished record ended up, for the client to echo back. */
export interface SavedTranscript {
  /**
   * A human-readable location: a repository-relative path in local mode, and a
   * row reference like `transcript #41` when there is no file. Shown to the
   * candidate at the end of a drill, so it has to mean something in both.
   */
  location: string
}

export interface HistoryPayload {
  rows: HistoryRow[]
  summary: HistorySummary
  /** Problems that have been paired on, which is not a spoiler — see `/api/history`. */
  coached: string[]
}

export interface WorkStore {
  /**
   * The buffer the candidate is typing into, for one problem.
   *
   * In-progress work rather than a finished record, which is why the comment at
   * the top of this file says "leaves behind" and this does not fit it — the
   * alternative was a second seam, a second dep and a second factory for two
   * methods that are per-user work stored per mode, which is exactly what this
   * interface already is. One seam, widened.
   *
   * Locally this is `problems/<pattern>/<slug>/solution.ts` itself: the file IS
   * the buffer, which is what makes `Run tests`, `pnpm reset` and `/review` all
   * work against the same bytes without any of them knowing about an editor.
   * Deployed it is a row, because there is one checkout and several people.
   *
   * Returns `null` when the slug resolves to no problem. Never a path — a
   * coding problem's directory is its pattern, and the pattern is the answer.
   */
  readSolution(slug: string): Promise<SolutionFile | null>
  /**
   * Write only if the buffer still holds what the caller last saw.
   *
   * `'stale'` is not a retryable error. It means something else holds the
   * buffer — a second tab, or locally the candidate's own editor — and the
   * client must keep the typed text and say so. Silently winning that race
   * destroys work, which is why the check and the write have to happen together
   * rather than as a read followed by a write.
   */
  writeSolution(slug: string, text: string, expected: string): Promise<WriteOutcome>
  /**
   * Persist the transcript body.
   *
   * `preferredPath` is the name local mode would like to use; the returned
   * location may differ, because `writeSession` refuses to overwrite an existing
   * transcript. `track` is passed rather than parsed back out of that path — the
   * caller has it, and a path is a local-mode detail that the database
   * implementation should not have to reverse-engineer.
   */
  saveTranscript(opts: { preferredPath: string; body: string; track: Track }): Promise<SavedTranscript>
  appendDrillLog(row: DrillLogRow): Promise<void>
  appendStoryLog(log: StoryLog): Promise<void>
  appendCoached(row: CoachedRow): Promise<void>
  readHistory(): Promise<HistoryPayload>
}
