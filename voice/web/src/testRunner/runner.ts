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
      finish({ kind: 'errored', message: 'the suite did not finish' })
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
