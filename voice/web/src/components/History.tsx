import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { HistoryPayload, HistoryRow } from '../types'
import { fmt } from '../phase'

/**
 * Past drills: what was attempted, whether it landed, and what it cost.
 *
 * Reads `local/drill-log.md` through `GET /api/history`. That file is the only
 * structured record any track keeps — the design and behavioural tracks write
 * free-form transcripts with no scores — so this screen is honest about covering
 * the coding drills alone rather than implying it is a complete picture.
 *
 * **Cold solves are reported separately from solves, everywhere.** The log's own
 * preamble is emphatic about it: "a solve that took four hints is a different
 * fact from a cold solve, and the log is useless if it flattens them." A single
 * "7 of 9 solved" headline is exactly that flattening, so the headline figure
 * here is the cold count and the solve count sits behind it.
 *
 * **Patterns are off by default and come from the server only when asked for.**
 * A history screen is read between drills, and `/review` re-queues problems for
 * spaced repetition — a permanent problem-to-pattern list would spoil every
 * re-drill at a glance. The reveal is a deliberate act, like `/coach` is.
 */

/** What each rung cost him, worded as what was already given away. Mirrors CodingTools. */
const RUNG = ['cold', 'nudged', 'pattern named', 'approach given', 'solution shown'] as const

function rungLabel(hints: number): string {
  return RUNG[Math.min(Math.max(hints, 0), RUNG.length - 1)] ?? 'unknown'
}

/**
 * How a row reads at a glance.
 *
 * Three outcomes, not two. A solve that needed the full worked solution is not
 * the same result as a cold one, and colouring them identically would undo the
 * distinction the rest of this screen is built around.
 */
function tone(row: HistoryRow): 'cold' | 'helped' | 'unsolved' {
  if (!row.solved) return 'unsolved'
  return row.hints === 0 ? 'cold' : 'helped'
}

function useHistory(reveal: boolean): { payload: HistoryPayload | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ payload: HistoryPayload | null; loading: boolean; failed: boolean }>({
    payload: null,
    loading: true,
    failed: false,
  })

  useEffect(() => {
    let live = true
    setState((prev) => ({ ...prev, loading: true }))
    void (async () => {
      try {
        const res = await fetch(`/api/history${reveal ? '?patterns=1' : ''}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as HistoryPayload
        if (live) setState({ payload, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ payload: null, loading: false, failed: true })
        console.error('voice: /api/history unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [reveal])

  return state
}

export function History({ onGoHome }: { onGoHome(): void }) {
  // Re-fetches when toggled rather than holding patterns client-side: the point
  // of withholding them is that they are not in the page until asked for.
  const [reveal, setReveal] = useState(false)
  const { payload, loading, failed } = useHistory(reveal)

  const summary = payload?.summary
  const rows = payload?.rows ?? []
  /**
   * Only the very first load blanks the screen.
   *
   * Toggling patterns refetches, and keying the table's visibility off `loading`
   * made the whole thing vanish and come back for a change that only adds a
   * column. `aria-busy` on the section still reports the refetch, so the state is
   * announced without the content leaving.
   */
  const firstLoad = loading && payload === null

  return (
    <div className="app-root">
      {/* Its own measure-constrained row rather than `home__header`, which is
          full-bleed: the title sat at x=0 while the table below it started at the
          content edge, so the screen read as two unrelated blocks. */}
      <header className="history__header">
        <h1 className="home__title">Past drills</h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>

      <section className="history" aria-busy={loading}>
        {firstLoad && <p className="home__note">Loading your drill log…</p>}

        {failed && (
          <p className="home__note">
            Could not read the drill log. The other screens do not use it and still work.
          </p>
        )}

        {!firstLoad && !failed && summary?.attempts === 0 && (
          <div className="history__empty">
            <p>
              Nothing logged yet. A drill writes a row here when it finishes — from <code>/drill</code> or from the
              spoken coding track, both of which append to the same log.
            </p>
            <p className="home__note">
              There is no score to show and nothing is wrong. This screen is only useful once there are a few rows in
              it.
            </p>
          </div>
        )}

        {!firstLoad && !failed && summary !== undefined && summary.attempts > 0 && (
          <>
            {/* Cold solves lead. See the component comment for why that is not
                interchangeable with the solve count. */}
            <dl className="history__summary">
              <div className="history__stat">
                <dt>Solved cold</dt>
                <dd>
                  {summary.cold}
                  <span className="history__of"> of {summary.attempts}</span>
                </dd>
              </div>
              <div className="history__stat">
                <dt>Solved with help</dt>
                <dd>{summary.solved - summary.cold}</dd>
              </div>
              <div className="history__stat">
                <dt>Not solved</dt>
                <dd>{summary.attempts - summary.solved}</dd>
              </div>
              <div className="history__stat">
                <dt>Problems seen</dt>
                <dd>{summary.problems}</dd>
              </div>
              <div className="history__stat">
                <dt>Median, when solved</dt>
                <dd>{summary.medianSolvedMs === null ? '—' : fmt(Math.round(summary.medianSolvedMs / 1000))}</dd>
              </div>
            </dl>

            <div className="history__controls">
              <Button variant="outline" onClick={() => setReveal((was) => !was)}>
                {reveal ? 'Hide patterns' : 'Reveal patterns'}
              </Button>
              <p className="home__note history__warning">
                {reveal
                  ? 'Patterns are showing. Re-drilling any problem listed here is spoiled while this is on.'
                  : 'Patterns are hidden, because a pattern is the answer — showing them would spoil a re-drill.'}
              </p>
            </div>

            <div className="history__scroller">
              <table className="history__table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Problem</th>
                    {reveal && <th scope="col">Pattern</th>}
                    <th scope="col">Result</th>
                    <th scope="col">Help taken</th>
                    <th scope="col">Time</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.date}-${row.problem}-${index}`} className={`history__row--${tone(row)}`}>
                      <td>{row.date}</td>
                      <td>
                        <code>{row.problem}</code>
                      </td>
                      {reveal && <td>{row.pattern ? <code>{row.pattern}</code> : '—'}</td>}
                      <td>{row.solved ? 'Solved' : 'Not solved'}</td>
                      <td>{rungLabel(row.hints)}</td>
                      <td>{row.elapsedMs === 0 ? '—' : fmt(Math.round(row.elapsedMs / 1000))}</td>
                      <td className="history__note">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="home__note">
              Coding drills only — the design and behavioural tracks write transcripts to <code>local/</code> rather
              than scores, so there is nothing comparable to list. For the full debrief on any row, run{' '}
              <code>/review &lt;problem&gt;</code>.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
