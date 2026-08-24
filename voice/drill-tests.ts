import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { classifyFailures, failedTestsFromJson, type DrillVerdict } from './drill-verdict'
import { stripPatternPaths, type ProblemLocation, problemDir } from './problems'

// Re-exported so every existing `from './drill-tests'` import keeps resolving
// unchanged — this file used to define these itself. The definitions now live
// in drill-verdict.ts, which imports no `node:*` module, so a browser client
// can pull in the verdict logic alone without dragging child_process along.
export {
  classifyFailures,
  failedTestName,
  failedTestsFromJson,
  verdictCue,
  type DrillVerdict,
  type FailedTest,
} from './drill-verdict'

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

export interface DrillTestOptions {
  root: string
  problem: ProblemLocation
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
