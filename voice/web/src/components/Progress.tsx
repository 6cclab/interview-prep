import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { ProgressPayload } from '../types'

/**
 * Cold vs helped vs unsolved, overall and by difficulty.
 *
 * Reads `GET /api/progress`, which is a straight tally the server already
 * computed — there is no join or filter logic here worth pulling into a
 * tested module, unlike `#/problems`. The one rule this screen exists to keep
 * is `History.tsx`'s: **cold and helped are never added together into one
 * "solved" number**, anywhere on this page. AGENTS.md is emphatic that a solve
 * that took hints is a different fact from a cold one, and a screen whose whole
 * purpose is progress is exactly where that flattening would be most tempting.
 */

function useProgress(): { payload: ProgressPayload | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ payload: ProgressPayload | null; loading: boolean; failed: boolean }>({
    payload: null,
    loading: true,
    failed: false,
  })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/progress')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as ProgressPayload
        if (live) setState({ payload: body, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ payload: null, loading: false, failed: true })
        console.error('voice: /api/progress unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return state
}

interface Props {
  onGoHome(): void
  onStudy(): void
}

export function Progress({ onGoHome, onStudy }: Props) {
  const { payload, loading, failed } = useProgress()

  return (
    <div className="app-root">
      <header className="screen__header">
        <h1 className="home__title">Progress</h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>

      <section className="screen progress" aria-busy={loading}>
        {loading && <p className="home__note">Loading progress…</p>}

        {!loading && failed && (
          <p className="home__note">Could not read progress. Reload to try again — the other screens still work.</p>
        )}

        {!loading && !failed && payload && (
          <>
            {/* Four figures, not two: the same three-way split History.tsx uses
                for a single row, rolled up here for the whole set. `total` is
                shown as context, never as a stand-in for "solved". */}
            <dl className="history__summary">
              <div className="history__stat">
                <dt>Solved cold</dt>
                <dd>{payload.summary.cold}</dd>
              </div>
              <div className="history__stat">
                <dt>Solved with help</dt>
                <dd>{payload.summary.helped}</dd>
              </div>
              <div className="history__stat">
                <dt>Attempted, not solved</dt>
                <dd>{payload.summary.unsolved}</dd>
              </div>
              <div className="history__stat">
                <dt>Not attempted</dt>
                <dd>{payload.summary.unattempted}</dd>
              </div>
              <div className="history__stat">
                <dt>Total problems</dt>
                <dd>{payload.summary.total}</dd>
              </div>
            </dl>

            <div className="screen__scroller">
              <table className="screen__table">
                <thead>
                  <tr>
                    <th scope="col">Difficulty</th>
                    <th scope="col">Cold</th>
                    <th scope="col">Helped</th>
                    <th scope="col">Unsolved</th>
                    <th scope="col">Unattempted</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.byDifficulty.map((row) => (
                    <tr key={row.difficulty}>
                      <td>{row.difficulty}</td>
                      <td>{row.cold}</td>
                      <td>{row.helped}</td>
                      <td>{row.unsolved}</td>
                      <td>{row.unattempted}</td>
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="problems__study-link">
              <Button variant="outline" onClick={onStudy}>
                See the pattern roadmap
              </Button>
              <p className="home__note">
                Groups every problem by the pattern it drills. The pattern is the answer, so this asks you to
                confirm before it shows anything.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
