import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import { Markdown } from './Markdown'
import type { ReviewPayload } from '../types'

/**
 * The worked debrief for one problem: the answer, the problem statement, and
 * the candidate's own last attempt, side by side.
 *
 * `GET /api/review/<slug>` 403s when there is no logged attempt for the slug —
 * mirroring `/review`'s own CLI gate (AGENTS.md: "Refuses without a finished
 * attempt in `local/drill-log.md`"). That 403 is rendered here as an
 * explanation of why there is nothing to show, not as a fetch-failure banner:
 * it is the expected shape of the response for a problem that has not been
 * drilled yet, not a broken request. `Problems.tsx` only ever links here from a
 * row that already has a logged attempt, so a visitor following that link
 * should never see this state — it exists for a hand-edited URL.
 */

type ReviewState =
  | { status: 'loading' }
  | { status: 'ok'; payload: ReviewPayload }
  | { status: 'forbidden' }
  | { status: 'failed' }

function useReview(slug: string): ReviewState {
  const [state, setState] = useState<ReviewState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    void (async () => {
      let res: Response
      try {
        res = await fetch(`/api/review/${encodeURIComponent(slug)}`)
      } catch (error) {
        if (live) setState({ status: 'failed' })
        console.error(`voice: /api/review/${slug} unreachable`, error)
        return
      }
      if (res.status === 403) {
        if (live) setState({ status: 'forbidden' })
        return
      }
      try {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as ReviewPayload
        if (live) setState({ status: 'ok', payload })
      } catch (error) {
        if (live) setState({ status: 'failed' })
        console.error(`voice: /api/review/${slug} returned something unusable`, error)
      }
    })()
    return () => {
      live = false
    }
  }, [slug])

  return state
}

export function Review({ slug, onGoHome }: { slug: string; onGoHome(): void }) {
  const state = useReview(slug)

  return (
    <div className="app-root">
      <header className="screen__header">
        <h1 className="home__title">
          Review <code>{slug}</code>
        </h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>

      <section className="screen review" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p className="home__note">Loading the debrief…</p>}

        {/* Not an error: a problem with nothing logged yet is the expected state
            for a hand-edited URL, not a broken request. Says what to do about
            it rather than just what went wrong. */}
        {state.status === 'forbidden' && (
          <div className="history__empty">
            <p>
              There is no logged attempt for <code>{slug}</code> yet, so there is nothing to debrief. Run{' '}
              <code>/drill {slug}</code> (or its spoken equivalent) first — this screen unlocks once that attempt is
              in <code>local/drill-log.md</code>.
            </p>
          </div>
        )}

        {state.status === 'failed' && (
          <p className="home__note">
            Could not read the debrief. Reload to try again — the other screens do not use this data and still
            work.
          </p>
        )}

        {state.status === 'ok' && (
          <>
            <dl className="history__summary">
              <div className="history__stat">
                <dt>Result</dt>
                <dd>{state.payload.row.solved ? 'Solved' : 'Not solved'}</dd>
              </div>
              <div className="history__stat">
                <dt>Pattern</dt>
                <dd>
                  <code>{state.payload.row.pattern ?? '—'}</code>
                </dd>
              </div>
              <div className="history__stat">
                <dt>Date</dt>
                <dd>{state.payload.row.date}</dd>
              </div>
            </dl>

            <section className="review__block">
              <h2 className="md__h2">Problem</h2>
              <Markdown source={state.payload.readme} />
            </section>

            {state.payload.attempt !== null && (
              <section className="review__block">
                <h2 className="md__h2">Your last attempt</h2>
                <pre className="md__pre">
                  <code>{state.payload.attempt}</code>
                </pre>
              </section>
            )}

            <section className="review__block">
              <h2 className="md__h2">Worked answer</h2>
              <Markdown source={state.payload.answer} />
            </section>
          </>
        )}
      </section>
    </div>
  )
}
