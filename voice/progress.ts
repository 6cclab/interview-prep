import type { CodingProblem, Difficulty } from './problems'
import type { HistoryRow } from './drill-log'

/**
 * The `GET /api/progress` breakdown: how many problems in each studyable tier
 * are cold, helped, unsolved, or not yet attempted.
 *
 * Four buckets rather than a "solved" count, because `local/drill-log.md`'s
 * own preamble is explicit about the distinction being the point: "a solve
 * that took four hints is a different fact from a cold solve, and the log is
 * useless if it flattens them." `cold` and `helped` are kept apart here for
 * that reason, and this is a per-difficulty rollup — no `pattern` axis exists
 * anywhere in this module or its output, because a per-pattern breakdown with
 * numbers on it is `patterns.md` again, just rendered as a progress bar.
 */

export interface DifficultyProgress {
  difficulty: Difficulty
  cold: number
  helped: number
  unsolved: number
  unattempted: number
  total: number
}

// The four tiers `/api/progress` reports on. `'unrated'` is a real value
// `Difficulty` can take, but it is not one of the tiers this screen buckets
// by — an unrated problem has no home here and contributes to no total,
// rather than being misfiled into whichever of the four happens to be first.
const STUDY_TIERS: readonly Difficulty[] = ['warmup', 'easy', 'medium', 'hard']

/**
 * Rolls a problem set and a drill log into per-tier counts.
 *
 * Each problem lands in exactly one of four buckets, decided in this order:
 * `cold` if any row ever solved it at rung 0 (a later helped attempt does not
 * un-cold a problem — the recall was proven once), else `helped` if any row
 * solved it at all (with hints), else `unsolved` if it has rows but none
 * solved it, else `unattempted`. That ordering is what keeps the four buckets
 * mutually exclusive and exhaustive: their sum is always `total`.
 */
export function progressByDifficulty(problems: CodingProblem[], rows: HistoryRow[]): DifficultyProgress[] {
  const attempts = new Map<string, HistoryRow[]>()
  for (const row of rows) {
    const list = attempts.get(row.problem) ?? []
    list.push(row)
    attempts.set(row.problem, list)
  }

  return STUDY_TIERS.map((difficulty) => {
    const inTier = problems.filter((p) => p.difficulty === difficulty)
    let cold = 0
    let helped = 0
    let unsolved = 0
    let unattempted = 0
    for (const problem of inTier) {
      const attemptRows = attempts.get(problem.slug) ?? []
      if (attemptRows.length === 0) {
        unattempted++
      } else if (attemptRows.some((r) => r.solved && r.hints === 0)) {
        cold++
      } else if (attemptRows.some((r) => r.solved)) {
        helped++
      } else {
        unsolved++
      }
    }
    return { difficulty, cold, helped, unsolved, unattempted, total: inTier.length }
  })
}
