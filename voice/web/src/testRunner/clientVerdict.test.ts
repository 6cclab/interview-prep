import { describe, expect, it, vi } from 'vitest'
import { computeVerdictInBrowser } from './clientVerdict'
import type { RunnerWorker } from './runner'

const EXERCISE_BODY = {
  stub: 'export function twoSum(): number[] { throw new Error("not implemented") }',
  test: "import { describe, it, expect } from 'vitest'\ndescribe('twoSum — correctness', () => { it('pairs', () => { expect(1).toBe(1) }) })",
  utils: {},
}

function okFetch(body: unknown = EXERCISE_BODY) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch
}

/** A worker that immediately answers with whatever reply it is given. */
function replyingWorker(reply: unknown): () => RunnerWorker {
  return () => {
    const worker: RunnerWorker = {
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => worker.onmessage?.({ data: reply as never }))
      },
      terminate() {},
    }
    return worker
  }
}

describe('computeVerdictInBrowser', () => {
  it('sends the editor buffer as the solution, never the stub it was seeded from', async () => {
    const spawn = vi.fn(replyingWorker({ ok: true, failed: [] }))
    let posted: unknown
    const spy = (): RunnerWorker => {
      const w = spawn()
      const original = w.postMessage.bind(w)
      w.postMessage = (exercise): void => {
        posted = exercise
        original(exercise)
      }
      return w
    }
    await computeVerdictInBrowser('two-sum-sorted', 'MY EDITED CODE', okFetch(), spy)
    expect((posted as { solution: string }).solution).toBe('MY EDITED CODE')
    // The stub is what the route serves; it is the seed for an empty editor,
    // never what gets tested once there is a buffer.
    expect((posted as { solution: string }).solution).not.toContain('not implemented')
  })

  it('classifies a clean run as green', async () => {
    const verdict = await computeVerdictInBrowser('s', 'code', okFetch(), replyingWorker({ ok: true, failed: [] }))
    expect(verdict.kind).toBe('green')
  })

  it('reports an errored verdict when the exercise cannot be fetched', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch
    const verdict = await computeVerdictInBrowser('s', 'code', failing, replyingWorker({ ok: true, failed: [] }))
    expect(verdict.kind).toBe('errored')
  })

  // The network is the one part of this that is not the candidate's code, and
  // a drill that silently reports green because a fetch failed would be worse
  // than one that says it could not run.
  it('reports an errored verdict when the request throws', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const verdict = await computeVerdictInBrowser('s', 'code', throwing, replyingWorker({ ok: true, failed: [] }))
    expect(verdict.kind).toBe('errored')
  })
})
