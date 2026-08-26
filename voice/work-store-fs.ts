import { appendCoached, readCoachedProblems, type CoachedRow } from './coached'
import { readDrillLog, summarise } from './drill-log'
import { appendDrillLog, appendStoryLog, writeSession, type DrillLogRow, type StoryLog } from './transcript'
import { readSolution, writeSolution, type SolutionFile, type WriteOutcome } from './solution-file'
import type { HistoryPayload, SavedTranscript, WorkStore } from './work-store'

/**
 * The record as Markdown in `local/`, which is what a local run has always
 * written and must keep writing.
 *
 * Every method here is a one-line delegation to code that already existed and is
 * already tested. That is the whole intent of the split: the local path is not
 * being rewritten to accommodate a database, it is being wrapped so a database
 * can sit beside it.
 *
 * The `async` is a formality on this side — none of these actually wait for
 * anything. It is the interface that is asynchronous, because the other
 * implementation genuinely is, and a synchronous interface would have forced the
 * database into a shape it does not have.
 */
export function fsWorkStore(root: string): WorkStore {
  return {
    // The file is the buffer here, and `solution-file.ts` explains at length why
    // that is the load-bearing choice rather than a shortcut: `Run tests`,
    // `pnpm reset` and `/review` all already work against that exact path.
    async readSolution(slug: string): Promise<SolutionFile | null> {
      return readSolution(root, slug)
    },

    async writeSolution(slug: string, text: string, expected: string): Promise<WriteOutcome> {
      return writeSolution(root, slug, text, expected)
    },

    async saveTranscript({ preferredPath, body }): Promise<SavedTranscript> {
      // `writeSession` will not overwrite an existing transcript, so the path it
      // used is not always the path it was asked for. Reporting back the one it
      // actually wrote is the difference between a link that opens and a link
      // that opens somebody else's drill.
      return { location: writeSession(root, preferredPath, body) }
    },

    async appendDrillLog(row: DrillLogRow): Promise<void> {
      appendDrillLog(root, row)
    },

    async appendStoryLog(log: StoryLog): Promise<void> {
      appendStoryLog(root, log)
    },

    async appendCoached(row: CoachedRow): Promise<void> {
      appendCoached(root, row)
    },

    async readHistory(): Promise<HistoryPayload> {
      const rows = readDrillLog(root)
      return { rows, summary: summarise(rows), coached: readCoachedProblems(root) }
    },
  }
}
