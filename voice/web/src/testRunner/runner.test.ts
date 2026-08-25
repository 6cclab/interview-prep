import { describe, expect, it } from 'vitest'
import { runInWorker, type RunnerWorker, type WorkerReply } from './runner'
import type { Exercise } from './execute'

const EXERCISE: Exercise = { test: '', solution: '', utils: {} }

/**
 * A stand-in for the browser's `Worker`.
 *
 * The Worker glue itself cannot be exercised under Node — there is no
 * `Worker`, and `worker_threads` is a different object with different
 * semantics. What *can* be tested is everything this module decides: when to
 * give up, what verdict each outcome maps to, and that the thread is always
 * killed. Those are the parts with the failure modes.
 */
function fakeWorker(): RunnerWorker & { terminated: number; posted: number } {
  return {
    terminated: 0,
    posted: 0,
    onmessage: null,
    onerror: null,
    postMessage() {
      this.posted += 1
    },
    terminate() {
      this.terminated += 1
    },
  }
}

const reply = (worker: RunnerWorker, data: WorkerReply): void => worker.onmessage?.({ data })

describe('runInWorker', () => {
  it('classifies a passing run as green', async () => {
    const worker = fakeWorker()
    const verdict = runInWorker(EXERCISE, () => worker)
    reply(worker, { ok: true, failed: [], logs: [] })
    expect((await verdict).verdict.kind).toBe('green')
  })

  it('classifies failures through the same logic the server uses', async () => {
    const worker = fakeWorker()
    const verdict = runInWorker(EXERCISE, () => worker)
    reply(worker, { ok: true, failed: [{ suite: 'twoSum — correctness', title: 'finds a pair' }], logs: [] })
    expect((await verdict).verdict.kind).not.toBe('green')
  })

  // The reason a Worker is used at all. A spinning thread ignores every
  // cooperative signal, so the only stop is terminate() from outside — and
  // the budget suites exist precisely to provoke code that spins.
  it('gives up on a suite that never finishes, and kills the thread', async () => {
    const worker = fakeWorker()
    let fire: (() => void) | undefined
    // The scheduler is injected so the 30-second ceiling can be reached
    // without waiting 30 seconds for it.
    const verdict = runInWorker(
      EXERCISE,
      () => worker,
      30_000,
      ((fn: () => void) => {
        fire = fn
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout,
      (() => {}) as unknown as typeof clearTimeout,
    )
    fire?.()
    expect((await verdict).verdict.kind).toBe('errored')
    expect(worker.terminated).toBe(1)
  })

  it('reports a worker that dies rather than waiting out the timeout', async () => {
    const worker = fakeWorker()
    const verdict = runInWorker(EXERCISE, () => worker)
    worker.onerror?.({})
    expect((await verdict).verdict.kind).toBe('errored')
    expect(worker.terminated).toBe(1)
  })

  // A Worker left alive holds its heap for the rest of the session, and a
  // candidate re-runs the suite dozens of times in one sitting.
  it('kills the thread on a normal finish too, not only on timeout', async () => {
    const worker = fakeWorker()
    const verdict = runInWorker(EXERCISE, () => worker)
    reply(worker, { ok: true, failed: [], logs: [] })
    await verdict
    expect(worker.terminated).toBe(1)
  })

  it('ignores a late reply after it has already settled', async () => {
    const worker = fakeWorker()
    const verdict = runInWorker(EXERCISE, () => worker)
    reply(worker, { ok: true, failed: [], logs: [] })
    await verdict
    reply(worker, { ok: false, message: 'too late' })
    expect(worker.terminated).toBe(1)
  })
})
