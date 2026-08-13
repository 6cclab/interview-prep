import { describe, expect, it } from 'vitest'
import { assertWithinBudget } from '../../../test-utils/oracle'
import { fetchAndPrint, type Deps } from './solution'

const bytes = (...values: number[]) => Uint8Array.from(values)

/**
 * A body plus a sink that tracks how much was yielded but not yet written.
 *
 * This is the cost mechanism, and it has to work this way: a solution that
 * buffers the entire response and writes it at the end produces byte-identical
 * output to a correct one. The only observable difference is *when* it writes,
 * so the harness records the high-water mark of unwritten chunks.
 */
function harness(chunks: Uint8Array[], throwAfter?: number) {
  let outstanding = 0
  let peak = 0
  const written: Uint8Array[] = []

  const deps: Deps = {
    async *open() {
      for (let i = 0; i < chunks.length; i++) {
        if (throwAfter !== undefined && i === throwAfter) {
          throw new Error('connection reset')
        }
        outstanding += 1
        peak = Math.max(peak, outstanding)
        yield chunks[i]!
      }
    },
    write(chunk) {
      written.push(chunk)
      outstanding = Math.max(0, outstanding - 1)
    },
  }

  return { deps, written: () => written, peak: () => peak }
}

/** Everything written, flattened, so chunk boundaries do not affect the assertion. */
function flatten(chunks: Uint8Array[]): number[] {
  return chunks.flatMap((c) => Array.from(c))
}

describe('fetchAndPrint — correctness', () => {
  it('writes the body through in order', async () => {
    const h = harness([bytes(1, 2), bytes(3), bytes(4, 5, 6)])
    await fetchAndPrint('https://example.test/a', h.deps)
    expect(flatten(h.written())).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('handles an empty body', async () => {
    const h = harness([])
    await fetchAndPrint('https://example.test/empty', h.deps)
    expect(flatten(h.written())).toEqual([])
  })

  it('handles a zero-length chunk in the middle of the body', async () => {
    // Not the end of the stream. A loop that stops on a falsy or empty chunk
    // truncates here and passes every other correctness test.
    const h = harness([bytes(1), bytes(), bytes(2)])
    await fetchAndPrint('https://example.test/gap', h.deps)
    expect(flatten(h.written())).toEqual([1, 2])
  })

  it('handles a single chunk', async () => {
    const h = harness([bytes(42)])
    await fetchAndPrint('https://example.test/one', h.deps)
    expect(flatten(h.written())).toEqual([42])
  })

  it('passes the url through to open', async () => {
    let seen: string | undefined
    const deps: Deps = {
      async *open(url) {
        seen = url
        yield bytes(1)
      },
      write() {},
    }
    await fetchAndPrint('https://example.test/specific', deps)
    expect(seen).toBe('https://example.test/specific')
  })

  it('propagates an error thrown before any chunk arrives', async () => {
    const h = harness([bytes(1)], 0)
    await expect(fetchAndPrint('https://example.test/dead', h.deps)).rejects.toThrow('connection reset')
  })

  it('propagates an error thrown partway through the body', async () => {
    // The dangerous case. Swallowing this resolves the promise, and the caller
    // believes it received a whole body when it received half of one.
    const h = harness([bytes(1), bytes(2), bytes(3)], 2)
    await expect(fetchAndPrint('https://example.test/cut', h.deps)).rejects.toThrow('connection reset')
    // What did arrive before the failure is fine to have written.
    expect(flatten(h.written())).toEqual([1, 2])
  })
})

describe('fetchAndPrint — bounded memory', () => {
  /**
   * The budget, not a timer. Collecting 200,000 chunks and writing them at the
   * end is fast and produces exactly the right bytes — it fails only on how
   * much it was holding, which is the requirement.
   *
   * `peak` is the high-water mark of chunks yielded but not yet written. A
   * streaming solution writes each chunk before asking for the next, so its
   * peak is 1. The budget is 2 rather than 1 so an implementation that keeps
   * one chunk of lookahead is not punished.
   */
  it('never holds more than a couple of chunks, however long the body is', async () => {
    const CHUNKS = 200_000
    const h = harness(Array.from({ length: CHUNKS }, (_, i) => bytes(i % 256)))

    await fetchAndPrint('https://example.test/huge', h.deps)

    expect(h.written().length).toBeGreaterThan(0)
    expect(flatten(h.written()).length).toBe(CHUNKS)
    assertWithinBudget(h.peak(), 2, 'fetchAndPrint retention')
  })

  it('starts writing before the body has finished arriving', async () => {
    // The same property stated the other way round, and the one that reads
    // most like the actual requirement: output must begin before input ends.
    let wroteBeforeEnd = false
    let finishedReading = false
    let writes = 0

    const deps: Deps = {
      async *open() {
        for (let i = 0; i < 100; i++) yield bytes(i)
        finishedReading = true
      },
      write() {
        writes += 1
        if (!finishedReading) wroteBeforeEnd = true
      },
    }

    await fetchAndPrint('https://example.test/live', deps)
    expect(writes).toBeGreaterThan(0)
    expect(wroteBeforeEnd).toBe(true)
  })
})
