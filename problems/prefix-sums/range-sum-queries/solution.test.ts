import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { rangeSums } from './solution'

describe('rangeSums — correctness', () => {
  it('answers a mix of ranges', () => {
    expect(rangeSums([1, 2, 3, 4, 5], [[0, 2], [1, 3], [4, 4], [0, 4]])).toEqual([6, 9, 5, 15])
  })

  it('handles negatives', () => {
    expect(rangeSums([-1, 3, -2], [[0, 1], [0, 2], [2, 2]])).toEqual([2, 0, -2])
  })

  it('handles a single-element range at both ends', () => {
    expect(rangeSums([7, 8, 9], [[0, 0], [2, 2]])).toEqual([7, 9])
  })

  it('returns an empty list for no queries', () => {
    expect(rangeSums([1, 2, 3], [])).toEqual([])
  })

  it('preserves query order rather than sorting', () => {
    expect(rangeSums([1, 2, 3, 4], [[3, 3], [0, 0], [1, 2]])).toEqual([4, 1, 5])
  })

  it('repeats the answer for a repeated query', () => {
    expect(rangeSums([1, 2, 3], [[0, 1], [0, 1]])).toEqual([3, 3])
  })

  // A range starting at 0 is the case an off-by-one in the precomputation gets
  // wrong, so it is asserted alongside one that does not.
  it('handles a range that starts at the beginning and one that does not', () => {
    expect(rangeSums([5, 5, 5, 5], [[0, 3], [1, 3]])).toEqual([20, 15])
  })
})

describe('rangeSums — scale', () => {
  const N = 200_000
  const Q = 200_000

  /**
   * Summing each range on arrival is O(n) per query. With 200,000 queries each
   * spanning most of a 200,000-element array, that is on the order of 10^10
   * additions, while one precomputation pass makes every query a single
   * subtraction. The measured gap is in
   * `solutions/prefix-sums/range-sum-queries.md`.
   *
   * Every value is 1, so the expected answer for `[from, to]` is exactly
   * `to - from + 1`. That is deliberate: any other fixture would need the test
   * to compute expected sums by precomputing prefix sums, which is
   * re-implementing the reference solution inside its own test. The ranges are
   * still varied and deterministic (`mulberry32`), so nothing about *which*
   * range is asked can be assumed — only the values are uniform.
   *
   * The correctness block above is where varied values are checked; the two
   * blocks together cover what one fixture cannot.
   */
  it('finishes well within budget on many wide queries', () => {
    const rand = mulberry32(0x1234)
    const values = new Array<number>(N).fill(1)
    const queries: [number, number][] = Array.from({ length: Q }, () => {
      // Wide by construction: the left end stays in the first tenth and the
      // right end in the last tenth, so no query is cheap to sum directly.
      const from = Math.floor(rand() * (N / 10))
      const to = N - 1 - Math.floor(rand() * (N / 10))
      return [from, to]
    })

    const t0 = performance.now()
    const result = rangeSums(values, queries)
    const elapsed = performance.now() - t0

    expect(result).toHaveLength(Q)

    // Every query is checked, but only a mismatch reaches `expect`. 200,000
    // assertion calls cost more than the reference solution itself, which would
    // shrink the measured gap this test exists to demonstrate.
    let mismatch = -1
    for (let i = 0; i < Q; i++) {
      const [from, to] = queries[i]!
      if (result[i] !== to - from + 1) {
        mismatch = i
        break
      }
    }
    expect(mismatch).toBe(-1)
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * Single-element queries over the same array. A from-scratch sum is cheap
   * here, so this asserts answers rather than the clock: it catches a
   * precomputation that is fast and wrong at the degenerate range.
   */
  it('is correct on many single-element queries', () => {
    const values = new Array<number>(N).fill(1)
    const queries: [number, number][] = Array.from({ length: N }, (_, i) => [i, i])

    const result = rangeSums(values, queries)

    expect(result).toHaveLength(N)
    expect(result.every((sum) => sum === 1)).toBe(true)
  })
})
