import type { Track } from './context'
import type { DrillLogRow, StoryLog } from './transcript'
import type { CoachedRow } from './coached'
import type { HistoryRow, HistorySummary } from './drill-log'

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
