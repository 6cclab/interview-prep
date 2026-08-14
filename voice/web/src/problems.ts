import type { HistoryRow, ProblemDetail } from './types'

/**
 * Joining `GET /api/problems/coding/detail` with `GET /api/history` for the
 * `#/problems` screen, and filtering the result.
 *
 * Pure and client-side on purpose: the join happens here rather than being a
 * fifth server field, because it needs no server change to add a filter and
 * because the two payloads already have to be fetched separately — the detail
 * list never carries a solved-state, and the history log never carries a
 * difficulty or a company. Neither endpoint gains a reason to know about the
 * other's shape.
 */

/**
 * Four outcomes, not two — same reasoning as `History.tsx`'s `tone()`, one
 * state further. `unattempted` exists because "never tried" and "tried and
 * lost" read as the same thing under a single `unsolved` bucket, and they are
 * not: one is a gap in coverage, the other is a gap in recall.
 */
export type SolvedState = 'cold' | 'helped' | 'unsolved' | 'unattempted'

export interface ProblemWithState extends ProblemDetail {
  solvedState: SolvedState
  /** Whether `#/review/<slug>` has anything to show — see Problems.tsx's row link. */
  hasAttempt: boolean
}

/**
 * A problem's state across every logged attempt, not just the latest one.
 *
 * A cold solve anywhere in the log wins over a later merely-helped one: it is
 * still evidence the pattern was once recalled without a hint, and burying that
 * under a worse subsequent attempt would understate what was actually shown.
 * `unsolved` is the fallback only once every attempt has come up empty.
 */
function solvedStateFor(slug: string, rows: readonly HistoryRow[]): SolvedState {
  const attempts = rows.filter((row) => row.problem === slug)
  if (attempts.length === 0) return 'unattempted'
  if (attempts.some((row) => row.solved && row.hints === 0)) return 'cold'
  if (attempts.some((row) => row.solved)) return 'helped'
  return 'unsolved'
}

export function joinSolvedState(problems: readonly ProblemDetail[], rows: readonly HistoryRow[]): ProblemWithState[] {
  return problems.map((problem) => ({
    ...problem,
    solvedState: solvedStateFor(problem.slug, rows),
    hasAttempt: rows.some((row) => row.problem === problem.slug),
  }))
}

export interface ProblemFilters {
  difficulty?: string
  solvedState?: SolvedState
  company?: string
}

/** All three filters are AND'd, and an absent filter passes everything through. */
export function filterProblems(problems: readonly ProblemWithState[], filters: ProblemFilters): ProblemWithState[] {
  return problems.filter((problem) => {
    if (filters.difficulty && problem.difficulty !== filters.difficulty) return false
    if (filters.solvedState && problem.solvedState !== filters.solvedState) return false
    if (filters.company && !problem.companies.some((company) => company.name === filters.company)) return false
    return true
  })
}

/** Distinct company names across the list, sorted for a stable picker order. */
export function companiesOf(problems: readonly ProblemDetail[]): string[] {
  const names = new Set<string>()
  for (const problem of problems) {
    for (const company of problem.companies) names.add(company.name)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Distinct difficulties across the list, sorted for a stable picker order. */
export function difficultiesOf(problems: readonly ProblemDetail[]): string[] {
  const values = new Set<string>()
  for (const problem of problems) values.add(problem.difficulty)
  return [...values].sort((a, b) => a.localeCompare(b))
}
