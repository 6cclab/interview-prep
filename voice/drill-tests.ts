import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { stripPatternPaths, type CodingProblem, problemDir } from './problems'

const run = promisify(execFile)

/**
 * Runs a coding drill's suite and classifies the result.
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

export interface DrillTestOptions {
  root: string
  problem: CodingProblem
  /**
   * Injectable so tests never spawn a real vitest. Contract: run the command and
   * leave vitest's JSON report at `reportPath` — the report, not a return value,
   * is what `runDrillTests` reads, so a fake must write one to stand in.
   */
  runner?(args: string[], cwd: string, reportPath: string): Promise<void>
}

/** Milliseconds before a drill's suite is considered hung rather than slow. */
const TEST_TIMEOUT_MS = 120_000

export async function runDrillTests(opts: DrillTestOptions): Promise<DrillVerdict> {
  const target = `${problemDir(opts.problem)}/solution.test.ts`
  // The report goes to a file, not stdout.
  //
  // stdout is shared with whatever the solution itself logs, and a mid-drill
  // `console.log({ n: 3 })` is entirely normal — which broke any attempt to
  // locate the JSON payload by scanning for braces. A file is unambiguous.
  const reportPath = join(mkdtempSync(join(tmpdir(), 'voice-drill-')), 'report.json')
  // The resolved path, not the slug: `vitest run <slug>` filters by substring,
  // so a slug that happens to appear elsewhere in the repo would drag unrelated
  // suites into a drill's verdict.
  const args = ['vitest', 'run', target, '--reporter=json', `--outputFile=${reportPath}`]
  const runner =
    opts.runner ??
    (async (a: string[], cwd: string) => {
      // Arguments as an array, never a shell string. Nothing here is
      // client-supplied — `problem` is resolved off disk — but a subprocess that
      // never sees a shell cannot be made to care.
      await run('npx', a, { cwd, timeout: TEST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
    })

  let runError: unknown
  try {
    await runner(args, opts.root, reportPath)
  } catch (error) {
    // A failing suite exits non-zero, and vitest has still written its report —
    // so an exception is only fatal if no report exists. Held rather than
    // returned, so the report is preferred over it when both are available.
    runError = error
  }

  let report: string
  try {
    report = readFileSync(reportPath, 'utf8')
  } catch {
    return {
      kind: 'errored',
      message: runError
        ? stripPatternPaths(errorMessage(runError))
        : 'The suite produced no report at all.',
    }
  } finally {
    rmSync(dirname(reportPath), { recursive: true, force: true })
  }

  try {
    const failed = failedTestsFromJson(report).map((test) => ({
      suite: stripPatternPaths(test.suite),
      title: stripPatternPaths(test.title),
    }))
    return classifyFailures(failed)
  } catch (error) {
    // A report that will not parse means the suite never ran as a suite — a
    // syntax or type error in the solution is the overwhelmingly likely cause,
    // and saying so is more useful than surfacing a JSON parse error.
    return {
      kind: 'errored',
      message: `The suite could not be run — usually a syntax or type error in the solution. (${stripPatternPaths(errorMessage(error))})`,
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
