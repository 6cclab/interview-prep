/**
 * The pure verdict logic for a coding drill's suite — no Node builtins, so the
 * browser client can share it byte-for-byte with the server.
 *
 * `drill.md` is emphatic that the two kinds of red mean opposite things and that
 * conflating them teaches the wrong lesson: correctness red means the answer is
 * wrong, while correctness-green-but-cost-red means the answer is *right* and
 * the cost is not — a working brute force, which is a legitimate checkpoint. So
 * this does not return "failed"; it returns which kind.
 *
 * The split is read off the suite names, which every one of the twenty problems
 * follows: `<fn> — correctness` for behaviour, and `— scale` / `— budget` /
 * `— access budget` / `— randomised trials` for cost. That convention is the
 * contract; `classifyFailures` is where it is encoded, and its test pins it.
 */

/** One failing test, split the way vitest's report actually splits it. */
export interface FailedTest {
  /** The enclosing `describe` names, outermost first, joined with ` > `. */
  suite: string
  /** The `it` name. */
  title: string
  /** The two numbers a budget assertion failed on, when it was one. See `parseCostMeasurement`. */
  cost?: CostMeasurement
}

/**
 * What a blown budget actually measured: the wall-clock the solution took, and
 * the ceiling it was asserted against.
 *
 * Both numbers are real and both come from the suite. Every cost fixture in
 * `problems/` times itself with `performance.now()` and asserts
 * `expect(elapsed).toBeLessThan(budget)`, so a failure states both — this is
 * read back off the assertion rather than derived, invented, or estimated.
 */
export interface CostMeasurement {
  actualMs: number
  budgetMs: number
}

/**
 * The two numbers out of a vitest budget failure, or null.
 *
 * Verified against a real report rather than assumed: the message is exactly
 * `AssertionError: expected 41203.482 to be less than 5000`.
 *
 * **Only the numbers are taken, never the message.** The rest of that string is
 * a stack trace whose first frame is the suite's absolute path — which contains
 * `problems/<pattern>/`, i.e. the answer. Returning a parsed pair rather than
 * the text is what makes the spoiler unreachable here instead of dependent on a
 * caller remembering to run `stripPatternPaths` over it.
 *
 * A non-finite or non-positive budget is refused: it would divide to Infinity or
 * NaN in the bar widths, and a bar of unknown length is worse than no bar.
 */
export function parseCostMeasurement(messages: string[] | undefined): CostMeasurement | null {
  for (const message of messages ?? []) {
    const found = /expected\s+([\d.]+)\s+to be less than\s+([\d.]+)/.exec(message)
    if (found === null) continue
    const actualMs = Number(found[1])
    const budgetMs = Number(found[2])
    if (!Number.isFinite(actualMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) continue
    return { actualMs, budgetMs }
  }
  return null
}

/** `<suite> > <title>` — the display form, built here so the delimiter is ours. */
export function failedTestName(test: FailedTest): string {
  return `${test.suite} > ${test.title}`
}

export type DrillVerdict =
  /** Everything passed. */
  | { kind: 'green' }
  /** At least one correctness test failed: the answer is wrong. */
  | { kind: 'correctness-red'; failed: string[] }
  /**
   * Correctness passed, a cost test did not: right answer, wrong cost.
   *
   * `measurement` is the worst of the failing budgets — see `classifyFailures`.
   * Optional because it is only present when the assertion was a `toBeLessThan`
   * one; a cost fixture that fails some other way still classifies correctly and
   * simply has no numbers to show.
   */
  | { kind: 'cost-red'; failed: string[]; measurement?: CostMeasurement }
  /** The suite could not be run at all — a compile error, a missing file. */
  | { kind: 'errored'; message: string }

/**
 * A `DrillVerdict` from an untrusted source, or null.
 *
 * A deployed instance runs the suite in the browser, so the verdict arrives
 * over the wire and is forgeable — that trade is accepted, because there is no
 * server-side execution left to protect and the interviewer's reaction is
 * coaching, not a score anyone can spend.
 *
 * What is *not* accepted is an unchecked shape reaching `verdictCue`, which
 * reads `failed` and interpolates it into the interviewer's prompt. Validating
 * here keeps a malformed body a 400 instead of a crash or a prompt built from
 * whatever arbitrary JSON was posted.
 */
export function parseDrillVerdict(value: unknown): DrillVerdict | null {
  if (typeof value !== 'object' || value === null) return null
  const { kind, failed, message, measurement } = value as Record<string, unknown>
  if (kind === 'green') return { kind }
  if (kind === 'errored') return typeof message === 'string' ? { kind, message } : null
  if (kind !== 'correctness-red' && kind !== 'cost-red') return null
  if (!Array.isArray(failed) || !failed.every((f) => typeof f === 'string')) return null
  if (kind === 'correctness-red') return { kind, failed: failed as string[] }
  // The measurement is dropped rather than rejected when it is malformed: it is
  // decoration on a verdict whose *kind* is the load-bearing part, and refusing
  // the whole body would turn a cosmetic problem into a failed test run.
  const checked = parseMeasurement(measurement)
  return checked === null ? { kind, failed: failed as string[] } : { kind, failed: failed as string[], measurement: checked }
}

/** A `CostMeasurement` off the wire, or null. Same bounds as `parseCostMeasurement`. */
function parseMeasurement(value: unknown): CostMeasurement | null {
  if (typeof value !== 'object' || value === null) return null
  const { actualMs, budgetMs } = value as Record<string, unknown>
  if (typeof actualMs !== 'number' || typeof budgetMs !== 'number') return null
  if (!Number.isFinite(actualMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) return null
  return { actualMs, budgetMs }
}

// A suite whose name marks it as testing behaviour rather than cost.
const CORRECTNESS = /—\s*correctness\b/i

/**
 * Which kind of red, from the failing tests' *suite* names.
 *
 * Matched against `suite` only, never the test title: the convention lives on the
 * `describe`, so a test whose own name mentions correctness must not flip a cost
 * failure into a correctness one — that would report a working brute force as a
 * wrong answer, the exact inversion `drill.md` warns about.
 */
export function classifyFailures(failed: FailedTest[]): DrillVerdict {
  if (failed.length === 0) return { kind: 'green' }
  const correctness = failed.filter((test) => CORRECTNESS.test(test.suite))
  if (correctness.length > 0) {
    return { kind: 'correctness-red', failed: correctness.map(failedTestName) }
  }
  // The worst overrun, by ratio rather than by absolute milliseconds: a 40s
  // answer against a 5s budget and a 3s answer against a 100ms one are 8x and
  // 30x, and the second is the more serious result even though it is the
  // smaller number. Deterministic, so two runs of the same failure agree.
  const measured = failed.map((test) => test.cost).filter((cost) => cost !== undefined)
  const measurement = measured.reduce<CostMeasurement | undefined>(
    (worst, cost) => (worst === undefined || cost.actualMs / cost.budgetMs > worst.actualMs / worst.budgetMs ? cost : worst),
    undefined
  )
  return measurement === undefined
    ? { kind: 'cost-red', failed: failed.map(failedTestName) }
    : { kind: 'cost-red', failed: failed.map(failedTestName), measurement }
}

/**
 * Vitest's JSON reporter, reduced to the failing tests' suite and title.
 *
 * Reads `ancestorTitles` and `title`, **not** `fullName`. `fullName` is the two
 * joined by a plain space (verified against a real report: `"maxArea —
 * correctness finds the canonical container"`), so there is no delimiter in it to
 * split on and no way to recover which part was the suite. Classification hangs
 * entirely on getting the suite, so it reads the structured fields.
 *
 * Only names are taken — never a failure message or diff. A budget assertion's
 * message states the actual call count, which is a measurement of his own
 * solution and harmless, but a scale fixture's diff can be a hundred thousand
 * numbers, and `drill.md` says to show the failing test names and nothing more.
 */
export function failedTestsFromJson(json: string): FailedTest[] {
  const parsed = JSON.parse(json) as {
    testResults?: {
      assertionResults?: {
        status?: string
        title?: string
        ancestorTitles?: string[]
        fullName?: string
        failureMessages?: string[]
      }[]
    }[]
  }
  const failed: FailedTest[] = []
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue
      const suite = (assertion.ancestorTitles ?? []).join(' > ')
      const title = assertion.title ?? assertion.fullName ?? '(unnamed test)'
      // The message itself is still never kept — `parseCostMeasurement` returns
      // two numbers or nothing, so the stack trace it was read out of (which
      // begins with the suite's `problems/<pattern>/` path) cannot travel.
      const cost = parseCostMeasurement(assertion.failureMessages)
      failed.push(cost === null ? { suite, title } : { suite, title, cost })
    }
  }
  return failed
}

/**
 * The bracketed note fed to the interviewer after a test run.
 *
 * Same shape and same reason as the design track's time check: it arrives in the
 * `user` slot where everything else is Andre speaking, so it is marked as an
 * aside, and `drill.md` supplies the behaviour — this only supplies the outcome.
 * It states the *meaning* of a cost-red rather than just the fact, because that
 * distinction is the one drill.md says must be made explicitly every time.
 */
export function verdictCue(verdict: DrillVerdict): string {
  if (verdict.kind === 'green') {
    return '[Test result, for you only: everything passed. Ask for his time and space complexity before you confirm he is done.]'
  }
  if (verdict.kind === 'correctness-red') {
    return `[Test result, for you only: correctness tests failed — ${verdict.failed.join('; ')}. The answer is wrong. Name the failing tests and nothing more; he keeps going.]`
  }
  if (verdict.kind === 'cost-red') {
    return `[Test result, for you only: correctness passed, cost failed — ${verdict.failed.join('; ')}. His answer is right and too expensive: a working brute force. Say exactly that, and do not describe it as a failed attempt.]`
  }
  return `[Test result, for you only: the suite could not be run. ${verdict.message}]`
}
