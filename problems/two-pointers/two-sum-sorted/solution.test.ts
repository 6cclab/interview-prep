import { describe, expect, it } from 'vitest'
import { twoSum } from './solution'

describe('twoSum — correctness', () => {
  it('finds the canonical pair', () => {
    expect(twoSum([2, 7, 11, 15], 9)).toEqual([0, 1])
  })

  it('finds a pair that is not at the ends', () => {
    expect(twoSum([1, 3, 4, 5, 7, 11], 9)).toEqual([2, 3])
  })

  it('uses two separate positions holding equal values', () => {
    // Not one position counted twice: i and j must differ.
    expect(twoSum([1, 2, 3, 4, 4, 9], 8)).toEqual([3, 4])
  })

  it('is null when no pair adds up', () => {
    expect(twoSum([1, 2, 3], 7)).toBeNull()
    expect(twoSum([1, 2], 100)).toBeNull()
  })

  it('does not reuse a single position to reach the target', () => {
    // 4 appears once; 4 + 4 must not be formed from it alone.
    expect(twoSum([1, 4, 9], 8)).toBeNull()
  })

  it('handles negative values', () => {
    expect(twoSum([-8, -3, 0, 2, 5], -3)).toEqual([0, 4])
    expect(twoSum([-5, -4, -3], -9)).toEqual([0, 1])
  })

  it('handles the smallest possible array', () => {
    expect(twoSum([1, 2], 3)).toEqual([0, 1])
  })
})

describe('twoSum — scale', () => {
  /**
   * A brute force that checks every pair is O(n^2). At n = 500,000 that is
   * 1.25*10^11 pair evaluations, measured here at 48 seconds per case, against
   * 6ms for a single converging sweep. That four-orders-of-magnitude gap is what
   * this test is for; it is not a performance micro-benchmark, which is why the
   * budget is a loose 5s rather than anything tight.
   *
   * The answer is known by construction rather than searched for. With
   * `numbers[i] = i`, the largest sum any pair can reach is
   * `(n - 1) + (n - 2)`, and exactly one pair reaches it — the last two
   * positions. Asking for that target therefore has a unique answer, and it
   * also happens to be the worst case for both approaches: the brute force
   * cannot stop early, and the sweep has to walk almost the whole array.
   */
  it('finishes well within budget on a large array whose only answer is at the end', () => {
    const N = 500_000
    const numbers = new Array<number>(N)
    for (let i = 0; i < N; i++) numbers[i] = i
    const target = (N - 1) + (N - 2)

    const t0 = performance.now()
    const result = twoSum(numbers, target)
    const elapsed = performance.now() - t0

    expect(result).toEqual([N - 2, N - 1])
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * The other worst case: no answer at all, so nothing can stop early. A target
   * one above the largest reachable sum is unreachable by construction.
   */
  it('finishes well within budget when there is no pair to find', () => {
    const N = 500_000
    const numbers = new Array<number>(N)
    for (let i = 0; i < N; i++) numbers[i] = i
    const target = (N - 1) + (N - 2) + 1

    const t0 = performance.now()
    const result = twoSum(numbers, target)
    const elapsed = performance.now() - t0

    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(5000)
  })
})
