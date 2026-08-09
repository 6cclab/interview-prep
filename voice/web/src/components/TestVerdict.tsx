import { Button } from 'brutalkit/button'
import type { DrillVerdict } from '../types'

/**
 * The coding track's test runner: one button, and the last verdict.
 *
 * `drill.md` step 7 has the interviewer run the suite and react. It has no
 * terminal here, so Andre presses the button and the server hands it the
 * outcome — the reaction arrives spoken, like everything else. This panel exists
 * because a suite takes real seconds and the press cannot go silent until the
 * interviewer starts talking.
 *
 * What it shows is deliberately only the *names* of failing tests. That is what
 * `drill.md` says to report and no more: a scale fixture's diff can be a hundred
 * thousand numbers, and a failure message that quotes the expected value would
 * hand over part of the answer.
 *
 * The two reds read differently on purpose. A cost failure means the answer is
 * *right* and too expensive — a working brute force, which is a real checkpoint
 * on the way to the intended solution. Rendering it the same as a wrong answer
 * would teach the exact thing drill.md is emphatic about not teaching.
 */

interface Props {
  verdict: DrillVerdict | null
  running: boolean
  /** Absent until a session is live — there is nothing to run tests against. */
  onRun?(): void
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

export function TestVerdict({ verdict, running, onRun }: Props) {
  const shown = verdict ? render(verdict) : null

  return (
    <section className="test-verdict" aria-label="Test run">
      <div className="test-verdict__row">
        <Button variant="brand" disabled={running || !onRun} onClick={onRun}>
          {running ? 'Running tests…' : 'Run tests'}
        </Button>
        <span className="test-verdict__hint">
          {onRun
            ? 'Runs this problem’s suite and tells the interviewer the result.'
            : 'Available once the interview has started.'}
        </span>
      </div>

      {/* Polite, not assertive: a test result is not an error, and the
          interviewer is about to say the same thing out loud anyway. */}
      <div aria-live="polite">
        {shown && (
          <div className={`test-verdict__result test-verdict__result--${shown.tone}`}>
            <strong className="test-verdict__headline">{shown.headline}</strong>
            <span className="test-verdict__body">{shown.body}</span>
            {shown.failed.length > 0 && (
              <ul className="test-verdict__failed">
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
