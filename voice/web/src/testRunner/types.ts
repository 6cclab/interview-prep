/**
 * Shapes shared by every file in this directory.
 *
 * Kept separate from `registry.ts` and `expect.ts` so `shim.ts` can re-export
 * a stable public surface without either implementation module importing the
 * other for types alone.
 */

/** One registered `it`, in the shape it existed in before it ran. */
export interface RegisteredTest {
  /** Enclosing `describe` names, outermost first — mirrors vitest's `ancestorTitles`. */
  ancestorTitles: string[]
  title: string
  fn: () => unknown | Promise<unknown>
}

/**
 * One `it`'s result, after running.
 *
 * `debugMessage` exists for local debugging only. `voice/drill-tests.ts`'s doc
 * comment is explicit that a fixture's expected values must never reach the
 * caller — only which test failed, never why — so nothing downstream of
 * `runSuite` may read this field into anything user-facing. See
 * `toFailedTests`, which drops it on the way out.
 */
export interface TestOutcome {
  ancestorTitles: string[]
  title: string
  status: 'passed' | 'failed'
  debugMessage?: string
}

export interface SuiteResult {
  outcomes: TestOutcome[]
  /** Whatever the candidate's code printed, in order, attributed to the test that was running. */
  logs: RunLog[]
}

/**
 * What the runner knows about a run that has not finished.
 *
 * Reported after each test, so that when the whole-suite ceiling fires the main
 * thread knows which test was still in flight rather than only that *something*
 * was. That difference is the whole point: a hung *cost* test is a working
 * answer too slow to measure, which is a legitimate `cost-red` checkpoint; a
 * hung *correctness* test is a loop that will not end. Reporting neither and
 * calling both `errored` inverts the distinction the drill exists to make.
 *
 * Sent between tests, which is the only moment it can be: `runSuite` awaits
 * each test, so the thread yields there and nowhere else. A test that spins
 * synchronously posts nothing after itself, which is exactly how its identity
 * survives as "the one still running".
 */
export interface SuiteProgress {
  /** The test that has just been started and has not yet reported an outcome. */
  running: FailedTest | null
  /** Every test that has finished and failed so far. */
  failed: FailedTest[]
}

/**
 * The shape `voice/drill-verdict.ts`'s `classifyFailures` and
 * `failedTestsFromJson` already consume — `suite` is `ancestorTitles` joined
 * with the same ` > ` delimiter vitest's JSON reporter's consumers expect.
 * Reusing this name/shape (rather than inventing a parallel one) is what lets
 * a browser-run result feed the existing classification logic unchanged.
 */
export interface FailedTest {
  suite: string
  title: string
}

/**
 * One line the candidate's own code printed while the suite ran.
 *
 * Safe to surface, and for the same reason a thrown error is: it is *their*
 * output. Nothing else writes to the console during a run — neither
 * `test-utils/` nor any of the suites — so a captured line came from the code
 * in the editor. That is what keeps this on the right side of the rule
 * `TestOutcome.debugMessage` exists to enforce: a matcher's message quotes the
 * fixture it compared against and must never leave the Worker; a `console.log`
 * quotes whatever the candidate chose to print.
 */
export interface RunLog {
  /** The test that was running, as `suite > title`. */
  test: string
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
}
