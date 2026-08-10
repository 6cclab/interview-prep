import { Button } from 'brutalkit/button'
import type { DrillVerdict } from '../types'

/**
 * The coding track's two actions: ask for a hint, and run the tests.
 *
 * Together in one panel because they are the two things a practice drill offers
 * that a real interview does not, and both belong where every other action
 * already is.
 *
 * **The hint ladder is the practice affordance.** These drills mimic an
 * interview, but they are for practice, so help exists — rationed, and visibly
 * so. Each press advances exactly one rung and the rung is stated on screen, so
 * the cost of asking is legible at the moment of asking rather than discovered
 * in the log afterwards. That legibility is the design: `local/drill-log.md`
 * says it outright — "a solve that took four hints is a different fact from a
 * cold solve, and the log is useless if it flattens them."
 *
 * The rung is the server's count, never this component's. It is what `/status`
 * reads to tell rust from coverage, so it is a measurement, not a tally kept in
 * a browser tab.
 *
 * What the test panel shows is deliberately only the *names* of failing tests.
 * That is what `drill.md` says to report and no more: a scale fixture's diff can
 * be a hundred thousand numbers, and a failure message that quotes the expected
 * value would hand over part of the answer.
 *
 * The two reds read differently on purpose. A cost failure means the answer is
 * *right* and too expensive — a working brute force, which is a real checkpoint
 * on the way to the intended solution. Rendering it the same as a wrong answer
 * would teach the exact thing drill.md is emphatic about not teaching.
 */

/**
 * What each rung has already given away. Mirrors `HINT_RUNGS` in voice/context.ts,
 * which is the authority — the client cannot import server code.
 *
 * Written as what he has been told, not as what to ask for next: the label's job
 * is to make the help already taken legible, and "pattern named" says that where
 * "ask for the pattern" would read as an invitation.
 */
const RUNG_TAKEN = ['no help taken', 'nudged', 'pattern named', 'approach given', 'solution shown'] as const

const MAX_RUNG = RUNG_TAKEN.length - 1

interface Props {
  verdict: DrillVerdict | null
  running: boolean
  hintRung: number
  hintPending: boolean
  /** Both absent until a session is live — there is nothing to act on. */
  onRun?(): void
  onHint?(): void
  /**
   * Whether help is rationed. True on the coding drill; false when coaching.
   *
   * When false the hint control and the rung line are **omitted, not disabled**.
   * There is no ladder in a coaching session — help is unrationed there by design
   * — so a greyed-out "Ask for a hint" would advertise a cost that does not
   * exist, and "Hints: 0 of 4" would imply a budget being tracked.
   */
  rationed?: boolean
}

interface Rendered {
  tone: 'green' | 'cost' | 'wrong' | 'errored'
  headline: string
  body: string
  failed: string[]
}

function render(verdict: DrillVerdict): Rendered {
  switch (verdict.kind) {
    case 'green':
      return {
        tone: 'green',
        headline: 'All tests passed',
        body: 'Correctness and cost. Expect to be asked for the time and space complexity before this counts as done.',
        failed: [],
      }
    case 'cost-red':
      return {
        tone: 'cost',
        headline: 'Right answer, too expensive',
        body: 'Every correctness test passed and a cost test did not. This is a working brute force — not a failed attempt.',
        failed: verdict.failed,
      }
    case 'correctness-red':
      return {
        tone: 'wrong',
        headline: 'Correctness tests failed',
        body: 'The answer is not right yet. These are the tests that failed:',
        failed: verdict.failed,
      }
    case 'errored':
      return {
        tone: 'errored',
        headline: 'The suite could not run',
        body: verdict.message,
        failed: [],
      }
  }
}

export function CodingTools({ verdict, running, hintRung, hintPending, onRun, onHint, rationed = true }: Props) {
  const shown = verdict ? render(verdict) : null
  const exhausted = hintRung >= MAX_RUNG

  return (
    <section className="coding-tools" aria-label={rationed ? 'Drill tools' : 'Pairing tools'}>
      <div className="coding-tools__row">
        <Button variant="brand" disabled={running || !onRun} onClick={onRun}>
          {running ? 'Running tests…' : 'Run tests'}
        </Button>

        {/* Secondary, and worded as a cost. Not because asking is discouraged —
            it is the point of practising rather than interviewing — but because
            the button that ends the turn should stay the obvious one. */}
        {rationed && (
          <Button variant="outline" disabled={hintPending || exhausted || !onHint} onClick={onHint}>
            {hintPending ? 'Asking…' : exhausted ? 'No hints left' : 'Ask for a hint'}
          </Button>
        )}

        <span className="coding-tools__rung" aria-live="polite">
          {!rationed
            ? 'Nothing is rationed here — ask out loud.'
            : onRun
              ? `Hints: ${hintRung} of ${MAX_RUNG} — ${RUNG_TAKEN[Math.min(hintRung, MAX_RUNG)]}`
              : 'Available once the interview has started.'}
        </span>
      </div>

      {/* Polite, not assertive: a test result is not an error, and the
          interviewer is about to say the same thing out loud anyway. */}
      <div aria-live="polite">
        {shown && (
          <div className={`coding-tools__result coding-tools__result--${shown.tone}`}>
            <strong className="coding-tools__headline">{shown.headline}</strong>
            <span className="coding-tools__body">{shown.body}</span>
            {shown.failed.length > 0 && (
              <ul className="coding-tools__failed">
                {shown.failed.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
