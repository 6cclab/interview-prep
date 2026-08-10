import { Button } from 'brutalkit/button'
import type { DebugVerdict } from '../types'

/**
 * The debugging track's two actions: run the two suites, and ask for a hint.
 *
 * Its own component rather than a mode of `CodingTools`, because the two things
 * the panel exists to communicate are both different here:
 *
 * **The verdict.** A coding drill has two kinds of red that mean opposite things.
 * This has two kinds of *green*, and the misleading one is the one that looks like
 * success — `repro` passing while `invariant` still fails is a symptom patch, and
 * `debug.md` is emphatic: "say it plainly rather than congratulating a partial
 * fix." So it is rendered as a finding in its own right, in the same visual
 * register as a failure, never as "1 of 2 suites passing".
 *
 * **The ladder.** It runs out after one rung, and that is a real property of the
 * track rather than a gap. Every rung past the first names part of the defect, and
 * the defect lives in `debugging/<exercise>/src/**` and
 * `solutions/debugging/<exercise>.md` — files the interviewer is deliberately
 * never shown. The server says so instead of letting a model invent a module,
 * because a confident wrong pointer costs more than no hint in an exercise whose
 * subject is forming a hypothesis. The button says so too, once it has happened:
 * pretending otherwise would be the screen making a promise the interviewer cannot
 * keep.
 *
 * Only failing test *names* are shown, the same as the coding panel: an assertion
 * message here quotes expected values from code he is trying to reason about.
 */

interface Props {
  verdict: DebugVerdict | null
  running: boolean
  /** The server's count of help actually given — see `hintRung` in useVoiceSession. */
  hintRung: number
  hintPending: boolean
  /**
   * False once an ask returned nothing, from the server's `servable` flag.
   *
   * A separate fact from `hintRung`, deliberately: a refusal is not help, so it
   * does not advance the rung, and without this the button would look identical
   * before and after the ladder ran out.
   */
  hintsExhausted: boolean
  /** Both absent until a session is live — there is nothing to act on. */
  onRun?(): void
  onHint?(): void
}

interface Rendered {
  tone: 'green' | 'cost' | 'wrong' | 'errored'
  headline: string
  body: string
  failed: string[]
}

function render(verdict: DebugVerdict): Rendered {
  switch (verdict.kind) {
    case 'root-cause':
      return {
        tone: 'green',
        headline: 'Both suites pass — root cause',
        body: 'The reported symptom and the second path with the same defect are both fixed. Expect to be asked whether your hypothesis held, and whether the fix is in the right place.',
        failed: [],
      }
    case 'symptom-patch':
      return {
        // Deliberately the same tone the coding panel uses for a right-but-costly
        // answer: a real checkpoint that is not done. Green would be a lie and
        // "wrong" would be too — the reported bug genuinely stopped reproducing.
        tone: 'cost',
        headline: 'Symptom patched, defect still there',
        body: 'The reported symptom is fixed and the second path with the same underlying defect is not. This is the finding the exercise exists to produce, not partial progress. What do the failing paths have in common?',
        failed: verdict.failed,
      }
    case 'unfixed':
      return {
        tone: 'wrong',
        headline: 'The symptom still reproduces',
        body: 'Both suites ship failing, so this is where every exercise starts. These are the tests still red:',
        failed: verdict.failed,
      }
    case 'errored':
      return {
        tone: 'errored',
        headline: 'The suites could not run',
        body: verdict.message,
        failed: [],
      }
  }
}

export function DebugTools({ verdict, running, hintRung, hintPending, hintsExhausted, onRun, onHint }: Props) {
  const shown = verdict ? render(verdict) : null

  return (
    <section className="coding-tools" aria-label="Debugging tools">
      <div className="coding-tools__row">
        <Button variant="brand" disabled={running || !onRun} onClick={onRun}>
          {running ? 'Running suites…' : 'Run both suites'}
        </Button>

        <Button variant="outline" disabled={hintPending || hintsExhausted || !onHint} onClick={onHint}>
          {hintPending ? 'Asking…' : hintsExhausted ? 'No hints left' : 'Ask for a hint'}
        </Button>

        <span className="coding-tools__rung" aria-live="polite">
          {!onRun
            ? 'Available once the interview has started.'
            : hintsExhausted
              ? 'The ladder stops here — past this a hint would name the defect, and the interviewer has not been shown it.'
              : hintRung > 0
                ? 'Hint taken: one question about where the behaviour diverges. That is the only rung available.'
                : 'One hint available — a question, not a pointer. The worked answer is /review, after.'}
        </span>
      </div>

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
