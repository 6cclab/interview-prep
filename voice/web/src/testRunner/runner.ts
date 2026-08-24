import { classifyFailures } from '../../../drill-verdict'
import type { DrillVerdict } from '../../../drill-verdict'
import type { Exercise } from './execute'
import type { FailedTest } from './types'

/**
 * What the Worker posts back. A thrown error carries the candidate's own
 * syntax or runtime failure, which is safe to surface — it is their code, not
 * a fixture's expected value.
 */
export type WorkerReply =
  | { ok: true; failed: FailedTest[] }
  | { ok: false; message: string }

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
 * **The other half of that question is not measured, and should not be assumed.**
 * Whether a *brute force* still finishes inside this ceiling when throttled
 * cannot be checked here: no brute-force implementations are committed to the
 * repo — they exist only while a suite is being authored, as one leg of the
 * three-way proof AGENTS.md requires. If a brute force does overrun, the verdict
 * degrades from `cost-red` (a legitimate checkpoint: a working answer that costs
 * too much) to `errored`, which is a materially worse message for exactly the
 * case the suite exists to catch. Raising this number is not the fix without a
 * measurement, because a longer ceiling is also a longer hang on a real infinite
 * loop; what it needs is brute-force fixtures to time against.
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
export function runInWorker(
  exercise: Exercise,
  spawn: () => RunnerWorker,
  timeoutMs: number = SUITE_TIMEOUT_MS,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): Promise<DrillVerdict> {
  return new Promise((resolve) => {
    const worker = spawn()
    let settled = false

    const finish = (verdict: DrillVerdict): void => {
      if (settled) return
      settled = true
      clearTimer(timer)
      // Terminated on every path, not just the timeout. A Worker left running
      // after a drill holds its heap for the rest of the session, and a
      // candidate re-runs the suite dozens of times in one sitting.
      worker.terminate()
      resolve(verdict)
    }

    const timer = setTimer(() => {
      // Names both causes, because the runner genuinely cannot tell them apart
      // and one of them is not a mistake. A scale suite that overruns is often a
      // working answer that costs too much — a cost-red, which is a legitimate
      // checkpoint — and a bare "did not finish" reads as a broken drill and
      // sends the candidate looking for a bug that is not there.
      finish({
        kind: 'errored',
        message: `the suite did not finish within ${Math.round(timeoutMs / 1000)}s — either it loops forever, or it is a working answer too slow to measure`,
      })
    }, timeoutMs)

    worker.onmessage = (event): void => {
      const reply = event.data
      finish(reply.ok ? classifyFailures(reply.failed) : { kind: 'errored', message: reply.message })
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
