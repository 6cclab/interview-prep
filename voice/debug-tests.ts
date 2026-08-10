import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { exerciseDir } from './exercises'

const run = promisify(execFile)

/**
 * Runs a debugging exercise's two suites and classifies the result.
 *
 * The classification *is* the exercise. `debug.md`: "Green on `repro` alone means
 * he patched the symptom. That is the finding, and it is the whole point of the
 * exercise — say it plainly rather than congratulating a partial fix." So this
 * never returns "failed" or even "passed"; it returns which of the four states
 * the pair of suites is in, and the interviewer is told what that state means.
 *
 * Note the shape of the parallel with the coding track: there, two kinds of red
 * mean opposite things (wrong answer versus working brute force). Here, two kinds
 * of *green* do — and the misleading one is the one that looks like success.
 *
 * The split is read off which **file** a failure came from, not off suite names.
 * That is the difference from `classifyFailures` in `drill-tests.ts`, and it is
 * forced: the two files' `describe` names are written by whoever authored the
 * exercise and follow no convention, while `repro.test.ts` and
 * `invariant.test.ts` are named by the track itself.
 */

/** One failing test, with the file it came from — the field the classification turns on. */
export interface FailedDebugTest {
  /** `repro` or `invariant`, from the filename. `unknown` for a file this track does not name. */
  file: 'repro' | 'invariant' | 'unknown'
  /** The enclosing `describe` names, outermost first, joined with ` > `. */
  suite: string
  /** The `it` name. */
  title: string
}

export type DebugVerdict =
  /** Both suites green: the root cause is fixed. The only success state. */
  | { kind: 'root-cause' }
  /**
   * `repro` green, `invariant` red. **The finding the exercise exists to produce.**
   * Its own kind rather than a flavour of failure, because it is the one outcome
   * that must never be reported as progress.
   */
  | { kind: 'symptom-patch'; failed: string[] }
  /** `repro` still red: the reported symptom is not fixed yet. */
  | { kind: 'unfixed'; failed: string[] }
  /**
   * The suites did not run, or reported failures from outside the two files this
   * track names. Not a verdict about his fix, and deliberately not folded into
   * `unfixed`: "your symptom still reproduces" and "I could not run your code"
   * are different things to hear.
   */
  | { kind: 'errored'; message: string }

/** `<suite> > <title>` for display. The file is reported separately — see `describeVerdict`. */
export function failedDebugTestName(test: FailedDebugTest): string {
  return test.suite ? `${test.suite} > ${test.title}` : test.title
}

/**
 * Which suite file a vitest report entry belongs to.
 *
 * Matched on the basename only. The full path is `debugging/<exercise>/…`, and
 * while an exercise name is a much weaker spoiler than a coding pattern,
 * `debug.md` still says not to display the path — so the path is reduced to the
 * one bit that matters here before it can reach a verdict, a cue or a screen.
 */
export function suiteFile(path: string): FailedDebugTest['file'] {
  const base = path.split('/').pop() ?? path
  if (base === 'repro.test.ts') return 'repro'
  if (base === 'invariant.test.ts') return 'invariant'
  return 'unknown'
}

/**
 * Vitest's JSON reporter, reduced to failing tests and which file each is in.
 *
 * `testResults[].name` is the file path; `assertionResults[]` are its tests. Both
 * are needed here, unlike on the coding track, which only ever asked about suite
 * names within a single file.
 */
export function failedDebugTestsFromJson(json: string): FailedDebugTest[] {
  const parsed = JSON.parse(json) as {
    testResults?: {
      name?: string
      assertionResults?: { status?: string; title?: string; ancestorTitles?: string[] }[]
    }[]
  }
  const failed: FailedDebugTest[] = []
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue
      failed.push({
        file: suiteFile(file.name ?? ''),
        suite: (assertion.ancestorTitles ?? []).join(' > '),
        title: assertion.title ?? '(unnamed test)',
      })
    }
  }
  return failed
}

export function classifyDebugFailures(failed: FailedDebugTest[]): DebugVerdict {
  if (failed.length === 0) return { kind: 'root-cause' }
  const repro = failed.filter((test) => test.file === 'repro')
  const invariant = failed.filter((test) => test.file === 'invariant')
  const unknown = failed.filter((test) => test.file === 'unknown')

  // Failures from neither named file mean the run picked up something this track
  // does not understand — reporting that as a verdict about his fix would be
  // guessing. Said out loud instead.
  if (unknown.length > 0 && repro.length === 0 && invariant.length === 0) {
    return {
      kind: 'errored',
      message: `The run reported failures from outside the exercise's two suites: ${unknown
        .map(failedDebugTestName)
        .join('; ')}`,
    }
  }
  if (repro.length > 0) {
    return { kind: 'unfixed', failed: [...repro, ...invariant].map(failedDebugTestName) }
  }
  return { kind: 'symptom-patch', failed: invariant.map(failedDebugTestName) }
}

export interface DebugTestOptions {
  root: string
  exercise: string
  /**
   * Injectable for the same reason the coding runner is: a real run spawns vitest
   * over Andre's half-finished fix. Contract: run the command and leave vitest's
   * JSON report at `reportPath`.
   */
  runner?(args: string[], cwd: string, reportPath: string): Promise<void>
}

/** Milliseconds before an exercise's suites are considered hung rather than slow. */
const TEST_TIMEOUT_MS = 120_000

export async function runDebugTests(opts: DebugTestOptions): Promise<DebugVerdict> {
  const dir = exerciseDir(opts.exercise)
  const reportPath = join(mkdtempSync(join(tmpdir(), 'voice-debug-')), 'report.json')
  // Both files named explicitly rather than filtering by exercise name: a name
  // that happens to appear elsewhere in the repo would drag unrelated suites into
  // the verdict, and here that would not merely add noise — an unrelated failure
  // in the wrong file changes which of the four states this reports.
  const args = [
    'vitest',
    'run',
    `${dir}/repro.test.ts`,
    `${dir}/invariant.test.ts`,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ]
  const runner =
    opts.runner ??
    (async (a: string[], cwd: string) => {
      await run('npx', a, { cwd, timeout: TEST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
    })

  let runError: unknown
  try {
    await runner(args, opts.root, reportPath)
  } catch (error) {
    // Both suites ship red, so a non-zero exit is the *normal* case here rather
    // than an exceptional one. Held, and only used if no report was written.
    runError = error
  }

  let report: string
  try {
    report = readFileSync(reportPath, 'utf8')
  } catch {
    return {
      kind: 'errored',
      message: runError ? errorMessage(runError) : 'The suites produced no report at all.',
    }
  } finally {
    rmSync(dirname(reportPath), { recursive: true, force: true })
  }

  try {
    return classifyDebugFailures(failedDebugTestsFromJson(report))
  } catch (error) {
    return {
      kind: 'errored',
      message: `The suites could not be run — usually a syntax or type error in the fix. (${errorMessage(error)})`,
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The bracketed note fed to the interviewer after a run.
 *
 * Same mechanism as the coding track's verdict and the design track's time check:
 * it lands in the `user` slot where everything else is Andre speaking, so it is
 * marked as an aside it never reads out.
 *
 * It states the *meaning* of each state rather than only the fact, and the
 * symptom-patch wording is the reason this function exists: `debug.md` says not to
 * soften it, and an interviewer left to interpret "repro passed, invariant failed"
 * congratulates a partial fix about as often as not.
 */
export function debugVerdictCue(verdict: DebugVerdict): string {
  if (verdict.kind === 'root-cause') {
    return (
      '[Test result, for you only: both suites passed — this is the root cause, not a ' +
      'symptom patch. Now work through the rest of debug.md\'s report in order: was his ' +
      'hypothesis right, and is the fix in the right place? Ask where else this defect ' +
      'could reappear.]'
    )
  }
  if (verdict.kind === 'symptom-patch') {
    return (
      '[Test result, for you only: repro passed and invariant did NOT — ' +
      `${verdict.failed.join('; ')}. This is a symptom patch, and it is the finding the ` +
      'exercise exists to produce. Say so directly and do not soften it or treat it as ' +
      'partial progress; then ask him what the two failing paths have in common. Do not ' +
      'name the file, the module or the cause yourself.]'
    )
  }
  if (verdict.kind === 'unfixed') {
    return (
      `[Test result, for you only: the reported symptom still reproduces — ${verdict.failed.join('; ')}. ` +
      'Name the failing tests and nothing more; he keeps working. Do not hint at the cause.]'
    )
  }
  return `[Test result, for you only: the suites could not be run. ${verdict.message}]`
}
