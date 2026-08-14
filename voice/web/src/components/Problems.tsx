import { useEffect, useMemo, useState } from 'react'
import { Button } from 'brutalkit/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from 'brutalkit/select'
import type { HistoryPayload, ProblemDetail, ProblemsDetailPayload } from '../types'
import { companiesOf, difficultiesOf, filterProblems, joinSolvedState, type SolvedState } from '../problems'

/**
 * The browsable coding list: every problem, filterable by difficulty,
 * solved-state and company.
 *
 * **Never fetches or shows a `pattern`.** `GET /api/problems/coding/detail` does
 * not carry the field at all (see `ProblemDetail`), so there is nothing here to
 * withhold — unlike `History.tsx`, which fetches a payload that *can* carry one
 * and gates it behind a toggle. This screen's only route to the pattern is the
 * "See the pattern roadmap" link below, which leaves for `#/study` and its own
 * confirmation gate.
 *
 * Solved-state is not on the wire either: it is joined client-side from
 * `GET /api/history` (no `?patterns=1`) against the detail list, in
 * `problems.ts`. Two independent fetches rather than a combined endpoint,
 * because they already fail independently — a history log with nothing logged
 * yet must not take the problem list down with it.
 */

/** Sentinel for "no filter", since Radix's Select reserves `''` for clearing a selection. Same trick as Home.tsx's `INTERVIEWERS_CHOICE`. */
const ALL = 'all'

function useProblemsDetail(): { problems: ProblemDetail[] | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ problems: ProblemDetail[] | null; loading: boolean; failed: boolean }>({
    problems: null,
    loading: true,
    failed: false,
  })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/problems/coding/detail')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as ProblemsDetailPayload
        if (live) setState({ problems: body.problems, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ problems: null, loading: false, failed: true })
        console.error('voice: /api/problems/coding/detail unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return state
}

/**
 * Deliberately not `patterns=1`: this screen never asks for the field it would
 * unlock. A separate hook from `History.tsx`'s `useHistory`, rather than that
 * one with `reveal` pinned to `false`, because this fetch never needs to
 * refetch — there is no toggle here to refetch on.
 */
function useHistoryRows(): { payload: HistoryPayload | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ payload: HistoryPayload | null; loading: boolean; failed: boolean }>({
    payload: null,
    loading: true,
    failed: false,
  })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/history')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as HistoryPayload
        if (live) setState({ payload: body, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ payload: null, loading: false, failed: true })
        console.error('voice: /api/history unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return state
}

const SOLVED_STATE_LABEL: Record<SolvedState, string> = {
  cold: 'Solved cold',
  helped: 'Solved with help',
  unsolved: 'Attempted, not solved',
  unattempted: 'Not attempted',
}

interface Props {
  onGoHome(): void
  onStudy(): void
  onReview(slug: string): void
}

export function Problems({ onGoHome, onStudy, onReview }: Props) {
  const detail = useProblemsDetail()
  const history = useHistoryRows()
  const [difficulty, setDifficulty] = useState<string>(ALL)
  const [solvedState, setSolvedState] = useState<string>(ALL)
  const [company, setCompany] = useState<string>(ALL)

  const loading = detail.loading || history.loading
  const failed = detail.failed || history.failed

  const joined = useMemo(
    () => (detail.problems ? joinSolvedState(detail.problems, history.payload?.rows ?? []) : []),
    [detail.problems, history.payload],
  )

  const filtered = useMemo(
    () =>
      filterProblems(joined, {
        difficulty: difficulty === ALL ? undefined : difficulty,
        solvedState: solvedState === ALL ? undefined : (solvedState as SolvedState),
        company: company === ALL ? undefined : company,
      }),
    [joined, difficulty, solvedState, company],
  )

  const difficulties = useMemo(() => (detail.problems ? difficultiesOf(detail.problems) : []), [detail.problems])
  const companies = useMemo(() => (detail.problems ? companiesOf(detail.problems) : []), [detail.problems])

  return (
    <div className="app-root">
      <header className="screen__header">
        <h1 className="home__title">Coding problems</h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>

      <section className="screen problems" aria-busy={loading}>
        {loading && <p className="home__note">Loading the problem list…</p>}

        {!loading && failed && (
          <p className="home__note">
            Could not read the problem list or the drill log. Reload to try again — the other screens do not use
            this data and still work.
          </p>
        )}

        {!loading && !failed && (
          <>
            <div className="problems__filters">
              <label className="home__label" htmlFor="problems-difficulty">
                Difficulty
              </label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger id="problems-difficulty" className="home__select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any difficulty</SelectItem>
                  {difficulties.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="home__label" htmlFor="problems-solved-state">
                Solved-state
              </label>
              <Select value={solvedState} onValueChange={setSolvedState}>
                <SelectTrigger id="problems-solved-state" className="home__select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any state</SelectItem>
                  {(Object.keys(SOLVED_STATE_LABEL) as SolvedState[]).map((state) => (
                    <SelectItem key={state} value={state}>
                      {SOLVED_STATE_LABEL[state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="home__label" htmlFor="problems-company">
                Company
              </label>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger id="problems-company" className="home__select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any company</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="screen__scroller">
              <table className="screen__table">
                <thead>
                  <tr>
                    <th scope="col">Problem</th>
                    <th scope="col">Difficulty</th>
                    <th scope="col">Companies</th>
                    <th scope="col">Solved-state</th>
                    <th scope="col">Debrief</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((problem) => (
                    <tr key={problem.slug} className={`screen__row--${problem.solvedState}`}>
                      <td>
                        {problem.title} <code>{problem.slug}</code>
                      </td>
                      <td>{problem.difficulty}</td>
                      <td>
                        {problem.companies.length === 0
                          ? '—'
                          : problem.companies.map((c) => `${c.name} (${c.confidence})`).join(', ')}
                      </td>
                      <td>{SOLVED_STATE_LABEL[problem.solvedState]}</td>
                      <td>
                        {/* Only offered where there is something to debrief — a
                            link into a 403 is a dead end dressed up as a feature. */}
                        {problem.hasAttempt ? (
                          <Button variant="ghost" size="sm" onClick={() => onReview(problem.slug)}>
                            Review
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length === 0 && <p className="home__note">No problem matches this filter.</p>}

            {/* Below the list, not beside it: this is a detour from browsing, not
                one more column of it. The confirmation itself lives on #/study —
                this is only the deliberate first step toward it. */}
            <div className="problems__study-link">
              <Button variant="outline" onClick={onStudy}>
                See the pattern roadmap
              </Button>
              <p className="home__note">
                Groups every problem above by the pattern it drills. The pattern is the answer to each one, so this
                asks you to confirm before it shows anything.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
