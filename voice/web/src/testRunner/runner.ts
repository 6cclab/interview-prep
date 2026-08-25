import { classifyFailures, failedTestName, isCorrectnessSuite } from '../../../drill-verdict'
import type { DrillVerdict } from '../../../drill-verdict'
import type { Exercise } from './execute'
import type { FailedTest, RunLog, SuiteProgress } from './types'

/**
 * What the Worker posts back. A thrown error carries the candidate's own
 * syntax or runtime failure, which is safe to surface — it is their code, not
 * a fixture's expected value.
 */
export type WorkerReply =
  | { ok: true; failed: FailedTest[]; logs: RunLog[] }
  | { ok: false; message: string }
  /** Between tests. See `SuiteProgress`. */
  | ({ ok: 'progress' } & SuiteProgress)

/** The slice of `Worker` this needs, so a test can supply one. */
export interface RunnerWorker {
  postMessage(exercise: Exercise): void
  terminate(): void
  onmessage: ((event: { data: WorkerReply }) => void) | null
  onerror: ((event: unknown) => void) | null
}

/**
 * A suite-level ceiling, not a per-test one.
 *
 * `vitest.config.ts` allows each test 10s; a whole suite finishing inside 30
 * covers the slowest scale test with room to spare, and anything past it is a
 * loop that is not going to end. The budget suites exist to punish exactly
 * that, so the runner has to survive it rather than hang with the tab.
 *
 * **Measured against the references, on 2026-08-24, through this runner.** All
 * twenty-six scale-test suites were run with their worked answers. The slowest
 * whole suite was `network-delay` at 366ms — 13.7× inside its own 5s assertion,
 * and eighty times inside this ceiling. `n-queens-count` is next at 264ms; every
 * other suite has 40× or more against its budget. So a browser 4–6× slower than
 * this machine still leaves the tightest case 2.3× of margin, and nothing is
 * near turning a correct answer into a cost-red.
 *
 * **The other half of that question is still not measured, and no longer needs
 * to be.** Whether a *brute force* finishes inside this ceiling when throttled
 * cannot be checked here — no brute-force implementations are committed to the
 * repo, they exist only while a suite is being authored, as one leg of the
 * three-way proof AGENTS.md requires. This note used to say the consequence was
 * that an overrun degrades from `cost-red` (a legitimate checkpoint: a working
 * answer that costs too much) to `errored`, and that fixing it needed fixtures
 * to time against.
 *
 * That framing was wrong about where the damage was. The number was never the
 * problem; the *classification* was. A budget test that cannot finish inside
 * this ceiling has, by any reading, exceeded its budget — that is the cost
 * signal, not the absence of one. So the Worker now reports which test it is in
 * before running it, and `verdictForTimeout` reads the `— correctness`
 * convention off that report: a hung cost test is `cost-red` naming it, a hung
 * correctness test stays `errored` because a correctness test that does not
 * return is a loop that will not end.
 *
 * This number is therefore deliberately unchanged. Raising it would still be
 * the wrong move for the reason this note always gave — a longer ceiling is a
 * longer hang on a real infinite loop — and the reason to raise it is gone.
 */
export const SUITE_TIMEOUT_MS = 30_000

/**
 * Run one drill's suite in a Worker and classify the result.
 *
 * The Worker is the containment. An infinite loop in the candidate's code
 * cannot be cancelled cooperatively — no timer fires inside a spinning
 * thread — so the only reliable stop is `terminate()` from outside it, which
 * is why this cannot simply run the suite on the main thread. A fresh Worker
 * per run means terminate is a whole-state kill with nothing to clean up.
 *
 * Returns the same `DrillVerdict` the server's `runDrillTests` returns, so the
 * UI renders a browser-run drill and a server-run one through one path.
 */
/**
 * A finished run: the verdict, and whatever the candidate's code printed.
 *
 * `logs` is empty on every path that is not a completed run — a timeout kills
 * the Worker with `terminate()`, and a terminated Worker posts nothing back.
 * That is a real limit rather than an oversight: the case where logs would help
 * most (a loop that never ends) is the one case they cannot be recovered from,
 * because the thread holding them never yields.
 */
export interface WorkerRun {
  verdict: DrillVerdict
  logs: RunLog[]
}

/**
 * What a run that hit the ceiling actually means.
 *
 * This used to be a flat `errored` naming both causes, on the reasoning that
 * the runner could not tell them apart. It can now: the Worker reports which
 * test it is in before running it, so when the ceiling fires the test still in
 * flight is known, and the convention that decides the two reds lives on the
 * `describe` name — `— correctness` — which that report carries.
 *
 * Three cases, in the order they are certain:
 *
 * 1. **A correctness test already failed.** The answer is wrong, and that is
 *    settled regardless of what hung afterwards. Reporting `errored` here would
 *    hide a fact the run had already established.
 * 2. **A cost test is the one that hung.** A budget test that cannot finish in
 *    the ceiling has, by any reading, exceeded its budget — that is the cost
 *    signal, not an absence of one. It is reported as `cost-red` naming that
 *    test, which is the legitimate checkpoint the old behaviour destroyed: a
 *    working answer that costs too much, degraded into "your drill broke".
 * 3. **Anything else** — a correctness test hung, or nothing was reported at
 *    all — stays `errored`. A correctness test that does not return is a loop
 *    that will not end, and papering over that would be the same mistake in the
 *    other direction.
 *
 * Note what this deliberately does *not* do: raise the ceiling. A longer
 * ceiling is also a longer hang on a real infinite loop, and the measurement
 * that would justify one needs brute-force fixtures that are not in the repo.
 * This fixes the classification instead, which is where the damage was.
 */
export function verdictForTimeout(progress: SuiteProgress, timeoutMs: number): DrillVerdict {
  const seconds = Math.round(timeoutMs / 1000)
  const correctness = progress.failed.filter((t) => isCorrectnessSuite(t.suite))
  if (correctness.length > 0) {
    return { kind: 'correctness-red', failed: correctness.map(failedTestName) }
  }
  const running = progress.running
  if (running !== null && !isCorrectnessSuite(running.suite)) {
    return { kind: 'cost-red', failed: [failedTestName(running)] }
  }
  return {
    kind: 'errored',
    message:
      running === null
        ? `the suite did not finish within ${seconds}s — either it loops forever, or it is a working answer too slow to measure`
        : `"${running.title}" did not finish within ${seconds}s — a correctness test that does not return is a loop that will not end`,
  }
}

export function runInWorker(
  exercise: Exercise,
  spawn: () => RunnerWorker,
  timeoutMs: number = SUITE_TIMEOUT_MS,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): Promise<WorkerRun> {
  return new Promise((resolve) => {
    const worker = spawn()
    let settled = false

    const finish = (verdict: DrillVerdict, logs: RunLog[] = []): void => {
      if (settled) return
      settled = true
      clearTimer(timer)
      // Terminated on every path, not just the timeout. A Worker left running
      // after a drill holds its heap for the rest of the session, and a
      // candidate re-runs the suite dozens of times in one sitting.
      worker.terminate()
      resolve({ verdict, logs })
    }

    const timer = setTimer(() => {
      finish(verdictForTimeout(progress, timeoutMs))
    }, timeoutMs)

    // The last thing the Worker said before it stopped saying anything.
    let progress: SuiteProgress = { running: null, failed: [] }

    worker.onmessage = (event): void => {
      const reply = event.data
      if (reply.ok === 'progress') {
        progress = { running: reply.running, failed: reply.failed }
        return
      }
      finish(
        reply.ok ? classifyFailures(reply.failed) : { kind: 'errored', message: reply.message },
        reply.ok ? reply.logs : [],
      )
    }

    // A Worker that dies outright — a parse failure in the candidate's code
    // reaches here rather than `onmessage`, and without this the drill would
    // sit on the timeout instead of reporting straight away.
    worker.onerror = (): void => {
      finish({ kind: 'errored', message: 'the suite could not be started' })
    }

    worker.postMessage(exercise)
  })
}
