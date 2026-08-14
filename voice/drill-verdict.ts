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
  /** Correctness passed, a cost test did not: right answer, wrong cost. */
  | { kind: 'cost-red'; failed: string[] }
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
  const { kind, failed, message } = value as Record<string, unknown>
  if (kind === 'green') return { kind }
  if (kind === 'errored') return typeof message === 'string' ? { kind, message } : null
  if (kind !== 'correctness-red' && kind !== 'cost-red') return null
  if (!Array.isArray(failed) || !failed.every((f) => typeof f === 'string')) return null
  return { kind, failed: failed as string[] }
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
  return { kind: 'cost-red', failed: failed.map(failedTestName) }
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
      assertionResults?: { status?: string; title?: string; ancestorTitles?: string[]; fullName?: string }[]
    }[]
  }
  const failed: FailedTest[] = []
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue
      const suite = (assertion.ancestorTitles ?? []).join(' > ')
      const title = assertion.title ?? assertion.fullName ?? '(unnamed test)'
      failed.push({ suite, title })
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
