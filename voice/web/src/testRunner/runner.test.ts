import { describe, expect, it } from 'vitest'
import { runInWorker, verdictForTimeout, type RunnerWorker, type WorkerReply } from './runner'
import { failedTestName } from '../../../drill-verdict'
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

/**
 * A run that hits the ceiling, classified rather than flattened.
 *
 * This was a flat `errored` naming both causes, on the reasoning that the
 * runner could not tell a loop from a slow-but-working answer. It can now: the
 * Worker reports which test it is in *before* running it, so when the ceiling
 * fires the test still in flight is known — and the convention that decides the
 * two reds lives on the `describe` name, which that report carries.
 *
 * The stakes are the repo's central distinction. A working brute force that
 * overruns is a `cost-red`, a legitimate checkpoint; reporting it as `errored`
 * tells the candidate their drill broke and sends them hunting a bug that is
 * not there — in exactly the case the budget suites exist to catch.
 */
describe('verdictForTimeout', () => {
  const cost = { suite: 'twoSum — cost', title: 'stays under 5s at n=100k' }
  const correctness = { suite: 'twoSum — correctness', title: 'finds the pair' }

  it('reports a hung cost test as cost-red, naming it', () => {
    const verdict = verdictForTimeout({ running: cost, failed: [] }, 30_000)
    expect(verdict.kind).toBe('cost-red')
    expect(verdict).toMatchObject({ failed: ['twoSum — cost > stays under 5s at n=100k'] })
  })

  /**
   * A correctness test that does not return is a loop that will not end.
   * Calling that `cost-red` would be the same inversion in the other
   * direction — telling someone their wrong answer is merely expensive.
   */
  it('leaves a hung correctness test as errored', () => {
    const verdict = verdictForTimeout({ running: correctness, failed: [] }, 30_000)
    expect(verdict.kind).toBe('errored')
  })

  /**
   * An already-failed correctness test settles the question regardless of what
   * hung afterwards: the answer is wrong. Reporting `errored` here would throw
   * away a fact the run had established before it stalled.
   */
  it('prefers a correctness failure that already happened', () => {
    const verdict = verdictForTimeout({ running: cost, failed: [correctness] }, 30_000)
    expect(verdict.kind).toBe('correctness-red')
    expect(verdict).toMatchObject({ failed: ['twoSum — correctness > finds the pair'] })
  })

  // Nothing reported at all — the suite hung before the first test, or during
  // registration. Both causes still have to be named, since neither is ruled out.
  it('names both causes when it never heard anything', () => {
    const verdict = verdictForTimeout({ running: null, failed: [] }, 30_000)
    expect(verdict.kind).toBe('errored')
    expect(verdict).toMatchObject({ message: expect.stringContaining('loops forever') })
  })

  // A cost failure that already happened is not preferred over the hung test:
  // both are cost, and the one that hung is the one the candidate is looking at.
  it('does not let a settled cost failure mask the hung one', () => {
    const other = { suite: 'twoSum — cost', title: 'stays under 5s at n=10k' }
    expect(verdictForTimeout({ running: cost, failed: [other] }, 30_000)).toMatchObject({
      kind: 'cost-red',
      failed: [failedTestName(cost)],
    })
  })
})

/**
 * End to end through `runInWorker`, with a Worker that reports progress and
 * then stops — which is what a synchronously spinning test looks like from
 * outside. Proves the progress messages are actually plumbed, not merely
 * classifiable in isolation.
 */
describe('a suite that hangs in a cost test', () => {
  it('is cost-red rather than errored', async () => {
    const hanging = (): RunnerWorker => {
      const worker: RunnerWorker = {
        postMessage() {
          // Two progress reports, then silence — the second test never settles.
          queueMicrotask(() => {
            worker.onmessage?.({
              data: {
                ok: 'progress',
                running: { suite: 'twoSum — correctness', title: 'finds the pair' },
                failed: [],
              },
            })
            worker.onmessage?.({ data: { ok: 'progress', running: null, failed: [] } })
            worker.onmessage?.({
              data: {
                ok: 'progress',
                running: { suite: 'twoSum — cost', title: 'stays under 5s' },
                failed: [],
              },
            })
          })
        },
        terminate() {},
        onmessage: null,
        onerror: null,
      }
      return worker
    }

    const run = await runInWorker(
      { test: '', solution: '', utils: {} },
      hanging,
      5,
    )
    expect(run.verdict.kind).toBe('cost-red')
    expect(run.verdict).toMatchObject({ failed: ['twoSum — cost > stays under 5s'] })
  })
})
