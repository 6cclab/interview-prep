import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { RoadmapPayload } from '../types'

/**
 * The pattern roadmap: every problem grouped by the pattern it drills.
 *
 * This is the one screen in the client that is allowed to name a pattern, and
 * the gate is the whole design. `GET /api/roadmap?study=1` is what actually
 * withholds the field on the wire without the query — the same shape as
 * `GET /api/history?patterns=1` — but the client-side half of the gate matters
 * too: **nothing is fetched until the confirmation fires**, not "fetched but
 * blurred" or "fetched but collapsed". The network tab, not just the screen,
 * should show nothing happened before the click.
 *
 * The confirmation is plain component state, not `sessionStorage` or anything
 * else that outlives this render. A reload lands back on the gate, which is
 * the point: reaching this screen is already a deliberate act (only linked
 * from `#/problems` and `#/progress`, never from header nav — see route.ts),
 * and the confirmation is a second deliberate act on top of that, not a
 * preference to remember.
 */

function useRoadmap(confirmed: boolean): { payload: RoadmapPayload | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ payload: RoadmapPayload | null; loading: boolean; failed: boolean }>({
    payload: null,
    loading: false,
    failed: false,
  })

  useEffect(() => {
    // The gate. Everything above this line runs on every render; nothing below
    // it runs until `confirmed` is true.
    if (!confirmed) return
    let live = true
    setState((prev) => ({ ...prev, loading: true }))
    void (async () => {
      try {
        const res = await fetch('/api/roadmap?study=1')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as RoadmapPayload
        if (live) setState({ payload: body, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ payload: null, loading: false, failed: true })
        console.error('voice: /api/roadmap?study=1 unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [confirmed])

  return state
}

export function Study({ onGoHome }: { onGoHome(): void }) {
  const [confirmed, setConfirmed] = useState(false)
  const { payload, loading, failed } = useRoadmap(confirmed)

  if (!confirmed) {
    return (
      <div className="app-root">
        <header className="screen__header">
          <h1 className="home__title">Study Mode</h1>
          <Button variant="outline" onClick={onGoHome}>
            Back
          </Button>
        </header>
        <section className="screen study__gate">
          <p>
            This groups every coding problem by the pattern it drills, and names each pattern outright. The pattern
            is the answer to its problem — <code>patterns.md</code> and every drill's hint ladder exist to keep it
            off screen until you ask for it, the same way <code>/coach</code> does.
          </p>
          <p className="home__note">
            Reading this spoils cold-recall practice for anything listed here. It is meant for planning what to
            drill next, not for browsing between attempts.
          </p>
          <div className="study__gate-actions">
            <Button variant="outline" onClick={onGoHome}>
              Never mind
            </Button>
            <Button variant="brand" onClick={() => setConfirmed(true)}>
              Show me the patterns
            </Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="app-root">
      <header className="screen__header">
        <h1 className="home__title">Pattern roadmap</h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>
      <section className="screen study" aria-busy={loading}>
        {loading && <p className="home__note">Loading the roadmap…</p>}
        {!loading && failed && (
          <p className="home__note">Could not read the roadmap. Reload to try again.</p>
        )}
        {!loading && !failed && payload && (
          <div className="study__patterns">
            {payload.patterns.map((group) => (
              <section key={group.pattern} className="study__pattern">
                <h2 className="md__h2">{group.pattern}</h2>
                <ul className="md__list">
                  {group.problems.map((problem) => (
                    <li key={problem.slug}>
                      {problem.title} <code>{problem.slug}</code>
                      {/* `cold` and `attempted` are the two booleans the roadmap
                          sends; a cold solve is the strongest signal and wins the
                          label, "attempted" without it says only that — it does not
                          claim a helped solve, since the roadmap does not say so. */}
                      {!problem.attempted && <span className="history__paired"> · not attempted</span>}
                      {problem.attempted && problem.cold && <span className="history__paired"> · solved cold</span>}
                      {problem.attempted && !problem.cold && <span className="history__paired"> · attempted</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
