import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { mergeIntervals, type Interval } from './solution'

describe('mergeIntervals — correctness', () => {
  it('handles the canonical mixed example', () => {
    expect(
      mergeIntervals([
        [1, 3],
        [2, 6],
        [8, 10],
        [15, 18],
      ]),
    ).toEqual([
      [1, 6],
      [8, 10],
      [15, 18],
    ])
  })

  it('handles input that is already ordered by start', () => {
    expect(
      mergeIntervals([
        [1, 2],
        [3, 4],
        [5, 6],
      ]),
    ).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })

  it('handles input given in reverse order', () => {
    // Catches a solution that assumes the input already arrives ordered by
    // start and walks it left-to-right without arranging it first.
    expect(
      mergeIntervals([
        [15, 18],
        [8, 10],
        [2, 6],
        [1, 3],
      ]),
    ).toEqual([
      [1, 6],
      [8, 10],
      [15, 18],
    ])
  })

  it('handles one interval fully containing another', () => {
    // Catches a solution that takes the later interval's end unconditionally
    // instead of the max of the two ends: [2,3] ends before [1,10] does, so
    // naively overwriting the running end with 3 would shrink [1,10] down to
    // [1,3] and lose [3,10] entirely.
    expect(
      mergeIntervals([
        [1, 10],
        [2, 3],
      ]),
    ).toEqual([[1, 10]])
  })

  it('merges intervals that only touch at an endpoint', () => {
    // Per the README: touching counts as overlapping.
    expect(
      mergeIntervals([
        [1, 4],
        [4, 5],
      ]),
    ).toEqual([[1, 5]])
  })

  it('collapses identical duplicate intervals into one', () => {
    expect(
      mergeIntervals([
        [5, 7],
        [5, 7],
        [5, 7],
      ]),
    ).toEqual([[5, 7]])
  })

  it('handles a single interval', () => {
    expect(mergeIntervals([[1, 2]])).toEqual([[1, 2]])
  })

  it('handles an empty list', () => {
    expect(mergeIntervals([])).toEqual([])
  })

  it('does not mutate the input array or its intervals', () => {
    const original: Interval[] = [
      [15, 18],
      [1, 3],
      [2, 6],
      [8, 10],
    ]
    const snapshot = original.map((iv) => [...iv])

    mergeIntervals(original)

    expect(original).toEqual(snapshot)
  })
})

describe('mergeIntervals — scale', () => {
  /**
   * The described brute force — repeatedly scan all pairs for one that
   * overlaps, merge it, and restart the scan from the top — is what this
   * fixture is built to punish.
   *
   * A chain of N intervals, each overlapping the next (`[i, i+2]` overlaps
   * `[i+1, i+3]` because i+1 <= i+2), collapses into a single interval by
   * construction, so the expected output is known analytically: no second
   * implementation is needed to check against, just arithmetic on N.
   *
   * The chain is generated in order and then independently shuffled (via
   * `shuffled` from test-utils/random, seeded through `mulberry32` so the
   * suite stays deterministic) before being handed to the function. That
   * matters: in the unshuffled order, a restart-from-the-top brute force
   * finds a mergeable neighbor within a couple of probes almost every time
   * and its passes stay cheap. Once the order is scrambled, each interval's
   * one or two overlapping partners land at effectively random positions,
   * so a full-array scan is needed to confirm a candidate has (or hasn't)
   * got one nearby, and that cost is paid on every one of the ~N restarts
   * needed to whittle N intervals down to 1. Measured directly (outside
   * Vitest): N = 150,000 took ~20.6s for that brute force, well past this
   * suite's 10s timeout, while the reference finishes in a few
   * milliseconds — several orders of magnitude of margin in both
   * directions.
   */
  it('merges a large shuffled chain of overlapping intervals into one', () => {
    const N = 150_000
    const SEED = 0xc0ffee

    const chain: Interval[] = Array.from({ length: N }, (_, i) => [i, i + 2])
    const input = shuffled(chain, mulberry32(SEED))

    const result = mergeIntervals(input)

    expect(result).toEqual([[0, N + 1]])
  })
})
