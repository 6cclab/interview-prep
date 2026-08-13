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
