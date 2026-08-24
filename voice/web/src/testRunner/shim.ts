/**
 * Vitest-compatible surface for running `problems/<pattern>/solution.test.ts`
 * inside a browser Web Worker, without a vitest (or any `node:*`) dependency
 * — vitest itself only runs under Node, so a drill taken through the browser
 * client needs a stand-in that a Worker can actually execute.
 *
 * Scoped to exactly what the 42 suites call: `describe`/`it` (no nesting
 * beyond one level in practice, but the registry supports arbitrary depth),
 * sync and async test bodies, and the matcher set enumerated in `expect.ts`.
 * No `test` alias, no `.each`, no `beforeEach`/`afterEach`, no `vi.*` — none
 * of the suites use them (verified by grep across all 42 files), so building
 * them would be surface with nothing to exercise it.
 */

export { describe, it, resetRegistry, runSuite } from './registry'
export { expect } from './expect'
export type { FailedTest, SuiteResult, TestOutcome } from './types'

import type { FailedTest, SuiteResult } from './types'

/**
 * Reduces a suite run to the shape `voice/drill-verdict.ts`'s
 * `classifyFailures` already accepts — `ancestorTitles` joined with the same
 * ` > ` `failedTestsFromJson` uses, so a browser-run result and a
 * server-run vitest JSON report classify identically without
 * `classifyFailures` itself changing.
 *
 * Only `suite`/`title` survive here — `TestOutcome.debugMessage` is dropped.
 * `voice/drill-tests.ts` documents why: a failing test's *name* is safe to
 * return (it is the candidate's own code that failed), but its message or
 * diff can restate a fixture's expected values, and the server's contract is
 * to never leak those. This is the one function in this module a caller
 * building a client-side report is expected to go through, precisely so that
 * boundary isn't left to be remembered ad hoc at every call site.
 */
export function toFailedTests(result: SuiteResult): FailedTest[] {
  return result.outcomes
    .filter((outcome) => outcome.status === 'failed')
    .map((outcome) => ({ suite: outcome.ancestorTitles.join(' > '), title: outcome.title }))
}
