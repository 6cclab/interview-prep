import { describe, expect, it } from 'vitest'
import { countWays } from './solution'

describe('countWays — correctness', () => {
  it('handles the smallest staircases', () => {
    expect(countWays(1)).toBe(1)
    expect(countWays(2)).toBe(2)
    expect(countWays(3)).toBe(3)
  })

  it('counts orderings as distinct', () => {
    // 1+2 and 2+1 are two different sequences, so n = 4 is 5 and not 4.
    expect(countWays(4)).toBe(5)
    expect(countWays(5)).toBe(8)
  })

  it('matches known values further along', () => {
    expect(countWays(10)).toBe(89)
    expect(countWays(20)).toBe(10946)
    expect(countWays(30)).toBe(1346269)
  })
})

describe('countWays — scale', () => {
  /**
   * The natural first attempt is `countWays(n - 1) + countWays(n - 2)`, straight
   * recursion with no reuse. It is correct, and its call count is itself the
   * answer's own growth rate — roughly 1.6^n calls, measured at 1.6x per step
   * from n = 30 through n = 42. Extrapolating from 0.92s at n = 42, n = 77 takes
   * on the order of six months, while reusing each subproblem once takes
   * microseconds. This is the one scale test here whose brute force never
   * returns at all rather than returning too slowly.
   *
   * n = 77 is the ceiling the problem states, and it is chosen for a second
   * reason: the answer at n = 78 exceeds `Number.MAX_SAFE_INTEGER`, so 77 is the
   * largest n at which the expected value below is exactly representable and the
   * test is checking arithmetic rather than floating-point drift.
   *
   * The expected value is written as a literal on purpose. Computing it here
   * with a loop would be re-implementing the reference solution inside its own
   * test, which proves nothing.
   */
  it('finishes well within budget at the largest allowed staircase', () => {
    const t0 = performance.now()
    const result = countWays(77)
    const elapsed = performance.now() - t0

    expect(result).toBe(8944394323791464)
    expect(elapsed).toBeLessThan(5000)
    expect(Number.isSafeInteger(result)).toBe(true)
  })

  /**
   * Called repeatedly across the whole range, so a solution that is fast only
   * because it caches across calls in module scope still has to be correct at
   * every n, and one that is exponential cannot hide behind a single small case.
   */
  it('finishes well within budget when called across the entire range', () => {
    const t0 = performance.now()
    const results = Array.from({ length: 77 }, (_, i) => countWays(i + 1))
    const elapsed = performance.now() - t0

    // Each value is the sum of the two before it, which is the one property the
    // test can check across the whole range without restating the algorithm.
    for (let i = 2; i < results.length; i++) {
      expect(results[i]).toBe(results[i - 1]! + results[i - 2]!)
    }
    expect(results[76]).toBe(8944394323791464)
    expect(elapsed).toBeLessThan(5000)
  })
})
