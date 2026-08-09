import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { hasDuplicate } from './solution'

describe('hasDuplicate — correctness', () => {
  it('finds a repeat', () => {
    expect(hasDuplicate([1, 2, 3, 1])).toBe(true)
  })

  it('is false when every value is distinct', () => {
    expect(hasDuplicate([1, 2, 3, 4])).toBe(false)
  })

  it('handles a single value', () => {
    expect(hasDuplicate([7])).toBe(false)
  })

  it('finds adjacent repeats', () => {
    expect(hasDuplicate([5, 5])).toBe(true)
  })

  it('finds a repeat separated by the whole array', () => {
    expect(hasDuplicate([9, 1, 2, 3, 4, 9])).toBe(true)
  })

  it('handles negatives and zero as distinct values', () => {
    expect(hasDuplicate([-1, 0, 1])).toBe(false)
    expect(hasDuplicate([-1, 0, -1])).toBe(true)
  })

  // 0 and -0 are the same number; a solution keyed on something that
  // distinguishes them would report a false negative here.
  it('treats 0 and -0 as the same value', () => {
    expect(hasDuplicate([0, -0])).toBe(true)
  })
})

describe('hasDuplicate — scale', () => {
  /**
   * Comparing every pair is O(n^2). At n = 500,000 with no duplicate present,
   * that is 1.25*10^11 comparisons and none of them can stop early — measured
   * here at 35 seconds, against 84ms for a single pass.
   *
   * All-distinct is deliberately the fixture: it is the only case a pairwise
   * solution cannot get lucky on. The values are a shuffled permutation, built
   * deterministically via `mulberry32`, so the array carries no exploitable
   * order — a solution cannot pass by assuming sorted input and comparing
   * neighbours.
   */
  it('finishes well within budget on a large all-distinct array', () => {
    const N = 500_000
    const rand = mulberry32(0x5eed)
    const values = shuffled(Array.from({ length: N }, (_, i) => i), rand)

    const t0 = performance.now()
    const result = hasDuplicate(values)
    const elapsed = performance.now() - t0

    expect(result).toBe(false)
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * A duplicate that only exists between the two *last* positions the array
   * holds, so finding it still requires having seen almost everything.
   */
  it('finishes well within budget when the only duplicate is at the far end', () => {
    const N = 500_000
    const rand = mulberry32(0xbeef)
    const values = shuffled(Array.from({ length: N - 1 }, (_, i) => i), rand)
    values.push(values[values.length - 1]!)

    const t0 = performance.now()
    const result = hasDuplicate(values)
    const elapsed = performance.now() - t0

    expect(result).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  })
})
