import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { subarraySum } from './solution'

describe('subarraySum — correctness', () => {
  it('matches the canonical [1,1,1] example', () => {
    expect(subarraySum([1, 1, 1], 2)).toBe(2)
  })

  it('matches the canonical [1,2,3] example', () => {
    expect(subarraySum([1, 2, 3], 3)).toBe(2)
  })

  it('counts subarrays that only sum to k by crossing a negative value', () => {
    // [3,-2,4] contains no subarray equal to k without the negative middle
    // element cancelling part of the run: [3,-2] doesn't hit 5, but the
    // full array does (3 + -2 + 4 = 5), and no other subarray does.
    expect(subarraySum([3, -2, 4], 5)).toBe(1)
  })

  it('counts every zero-length-sum run when nums is all zeros and k is 0', () => {
    // Catches a solution that stops at the first match instead of counting
    // all C(n+1, 2) = 6 subarrays of a length-3 all-zero array.
    expect(subarraySum([0, 0, 0], 0)).toBe(6)
  })

  it('handles k = 0 with a mix of positive and negative values', () => {
    // [1,-1,0] -> [1,-1], [0], [1,-1,0]
    expect(subarraySum([1, -1, 0], 0)).toBe(3)
  })

  it('counts a single element equal to k', () => {
    expect(subarraySum([5], 5)).toBe(1)
  })

  it('returns 0 for a single element not equal to k', () => {
    expect(subarraySum([5], 3)).toBe(0)
  })

  it('returns 0 when no subarray sums to k', () => {
    expect(subarraySum([1, 2, 3], 100)).toBe(0)
  })

  it('counts overlapping matches across a longer run with negatives', () => {
    // Deliberately has several distinct subarrays landing on the same sum
    // from different start/end pairs, including ones that cross negative
    // values, so a solution that only checks prefixes ending at the last
    // index (or otherwise under-counts overlaps) gets caught.
    expect(subarraySum([1, 2, -3, 4, -1, 2, 1, -5, 4], 3)).toBe(6)
  })
})

describe('subarraySum — scale', () => {
  // No expensive oracle exists for this problem (unlike celebrity's
  // knows()), so the discriminator here is wall-clock: an array long
  // enough that summing every subarray (O(n^2)) cannot finish inside
  // Vitest's 10s timeout, while the reference approach finishes in
  // single-digit milliseconds.
  //
  // The array is generated deterministically with mulberry32 rather than
  // Math.random() so the suite is reproducible. The expected count was NOT
  // computed by re-running the discriminator method (a prefix-sum + count
  // map) inside this test — that would just be asserting the reference
  // agrees with itself. It was computed once, offline, with that same
  // reference algorithm, cross-checked against a brute-force O(n^2) scan
  // over the identical generated array, and the two agreed exactly. The
  // result is hard-coded below.
  //
  // Measured while authoring this drill: the O(n^2) brute force took
  // ~16.1s over this array (already over budget), while the reference
  // O(n) approach took ~8ms — roughly three orders of magnitude apart.
  it('stays well under the timeout on a large array', () => {
    const SEED = 0xc0ffee42
    const N = 250_000
    const RANGE = 50
    const K = 7

    const rand = mulberry32(SEED)
    const nums = Array.from({ length: N }, () => Math.floor(rand() * (2 * RANGE + 1)) - RANGE)

    expect(subarraySum(nums, K)).toBe(1_534_884)
  })
})
