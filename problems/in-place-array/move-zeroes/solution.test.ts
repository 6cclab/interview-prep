/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: any correct approach visits each element a constant number of
 * times, so there is no asymptotically-worse-but-correct alternative to reject.
 * See ".claude/CLAUDE.md" > "The warm-up tier" for why that exemption exists.
 *
 * What it does check is order preservation, which is where the tempting
 * shortcut — swapping each zero with the last element — quietly goes wrong.
 */

import { describe, expect, it } from 'vitest'
import { firstDifference } from '../../../test-utils/sequence'
import { moveZeroes } from './solution'

describe('moveZeroes — correctness', () => {
  it('moves zeroes to the end and keeps the rest in order', () => {
    const nums = [0, 1, 0, 3, 12]
    moveZeroes(nums)
    expect(nums).toEqual([1, 3, 12, 0, 0])
  })

  it('handles leading zeroes', () => {
    const nums = [0, 0, 1]
    moveZeroes(nums)
    expect(nums).toEqual([1, 0, 0])
  })

  it('leaves an array with no zeroes unchanged', () => {
    const nums = [1, 2, 3]
    moveZeroes(nums)
    expect(nums).toEqual([1, 2, 3])
  })

  it('handles an array of only zeroes', () => {
    const nums = [0, 0, 0]
    moveZeroes(nums)
    expect(nums).toEqual([0, 0, 0])
  })

  it('handles a single element', () => {
    const zero = [0]
    moveZeroes(zero)
    expect(zero).toEqual([0])

    const nonZero = [7]
    moveZeroes(nonZero)
    expect(nonZero).toEqual([7])
  })

  it('handles an empty array', () => {
    const nums: number[] = []
    moveZeroes(nums)
    expect(nums).toEqual([])
  })

  it('preserves negative values and their order', () => {
    const nums = [0, -1, 0, -3, 2]
    moveZeroes(nums)
    expect(nums).toEqual([-1, -3, 2, 0, 0])
  })

  // Swapping each zero with the end of the array moves the zeroes correctly but
  // scrambles the non-zero values. This is the case that catches it.
  it('does not reorder the non-zero values', () => {
    const nums = [1, 0, 2, 0, 3, 0, 4]
    moveZeroes(nums)
    expect(nums).toEqual([1, 2, 3, 4, 0, 0, 0])
  })

  it('mutates the array it was given rather than a copy', () => {
    const nums = [0, 5]
    const sameReference = nums
    moveZeroes(nums)
    expect(sameReference).toEqual([5, 0])
  })

  // Compared through `firstDifference` rather than `toEqual`: a 100k-element
  // mismatch printed in full is unreadable and scrolls every other failure in
  // this file off screen. See `test-utils/sequence.ts`.
  it('handles a long array', () => {
    const nums = Array.from({ length: 100_000 }, (_, i) => (i % 3 === 0 ? 0 : i))
    const expectedNonZero = nums.filter((n) => n !== 0)
    const expectedZeroes = nums.length - expectedNonZero.length
    moveZeroes(nums)
    expect(firstDifference(nums, [...expectedNonZero, ...Array(expectedZeroes).fill(0)])).toBeNull()
  })
})
