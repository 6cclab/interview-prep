import type { CodingProblemDetail } from './problems'
import type { HistoryRow } from './drill-log'

/**
 * The `GET /api/roadmap?study=1` grouping: problems clustered by pattern, but
 * only for problems that have actually been drilled.
 *
 * `voice/problems.ts` says the pattern "reaches exactly one consumer on
 * purpose: the interviewer." This module is deliberately not a second one —
 * every group's `pattern` comes from the matching `HistoryRow`, which the
 * candidate's own drill wrote into `local/drill-log.md`, never from
 * `CodingProblemDetail.pattern`. That is what makes the stricter half of the
 * gate hold structurally rather than by this function remembering to enforce
 * it: a problem with no row simply has no `HistoryRow` to read a pattern off
 * of, so there is no pattern value in scope to attach to it, even for a
 * problem whose *true* pattern is already visible because a sibling problem
 * in the same pattern has been attempted. Without this, "unattempted stays
 * anonymous" would be one `if` a future edit could quietly delete; this way
 * there is no pattern-bearing field to reach for in the first place.
 */

export interface RoadmapProblem {
  slug: string
  title: string
  attempted: boolean
  /** Solved at rung 0 at least once. A later helped attempt does not undo this. */
  cold: boolean
}

export interface RoadmapGroup {
  /** `null` for the anonymous bucket — every problem with no attempted row. */
  pattern: string | null
  problems: RoadmapProblem[]
}

export function buildRoadmap(problems: CodingProblemDetail[], rows: HistoryRow[]): RoadmapGroup[] {
  const attempts = new Map<string, HistoryRow[]>()
  for (const row of rows) {
    const list = attempts.get(row.problem) ?? []
    list.push(row)
    attempts.set(row.problem, list)
  }

  const byPattern = new Map<string, RoadmapProblem[]>()
  const anonymous: RoadmapProblem[] = []

  for (const problem of problems) {
    const attemptRows = attempts.get(problem.slug) ?? []
    const entry: RoadmapProblem = {
      slug: problem.slug,
      title: problem.title,
      attempted: attemptRows.length > 0,
      cold: attemptRows.some((r) => r.solved && r.hints === 0),
    }
    // `voice/drill-log.ts` maps an unrecognised pattern cell to `''`, so a
    // hand-edited row that names no pattern is treated the same as no row —
    // still `attempted`, still anonymous, never grouped under `''`.
    const pattern = attemptRows.find((r) => r.pattern !== '')?.pattern
    if (pattern) {
      const list = byPattern.get(pattern) ?? []
      list.push(entry)
      byPattern.set(pattern, list)
    } else {
      anonymous.push(entry)
    }
  }

  const groups: RoadmapGroup[] = [...byPattern.entries()].map(([pattern, groupProblems]) => ({
    pattern,
    problems: groupProblems,
  }))
  // Omitted entirely when empty, not sent as `{ pattern: null, problems: [] }`
  // — an empty anonymous group would tell a client "there is nothing left
  // unattempted," which is exactly the fact ?study=1 must not volunteer for
  // free when it happens to be true for other reasons.
  if (anonymous.length > 0) groups.push({ pattern: null, problems: anonymous })
  return groups
}
