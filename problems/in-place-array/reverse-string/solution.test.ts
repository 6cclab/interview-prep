/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: reversing an array is linear however you do it, so there is no
 * asymptotically-worse-but-correct approach to reject. What it does check is
 * that the work landed *in the input array*, which is the only thing a caller
 * can observe — see ".claude/CLAUDE.md" > "The warm-up tier".
 *
 * **A known and deliberate hole: `chars.reverse()` passes every test here.** It
 * mutates in place, so it satisfies the only property a caller can observe, and
 * no assertion can see which statements produced the result. The exercise is the
 * index arithmetic, so the constraint lives in the README where a human reads it
 * rather than in a test that cannot enforce it. Do not try to close this with a
 * source check or a monkeypatched prototype — that tests the harness, not the
 * candidate, and a drill whose suite polices *how* you typed something is a
 * worse drill than one that asks and trusts.
 */

import { describe, expect, it } from 'vitest'
import { firstDifference } from '../../../test-utils/sequence'
import { reverseString } from './solution'

describe('reverseString — correctness', () => {
  it('reverses an odd-length array', () => {
    const chars = ['h', 'e', 'l', 'l', 'o']
    reverseString(chars)
    expect(chars).toEqual(['o', 'l', 'l', 'e', 'h'])
  })

  it('reverses an even-length array', () => {
    const chars = ['a', 'b', 'c', 'd']
    reverseString(chars)
    expect(chars).toEqual(['d', 'c', 'b', 'a'])
  })

  it('leaves a single character alone', () => {
    const chars = ['x']
    reverseString(chars)
    expect(chars).toEqual(['x'])
  })

  it('handles an empty array', () => {
    const chars: string[] = []
    reverseString(chars)
    expect(chars).toEqual([])
  })

  it('handles repeated characters', () => {
    const chars = ['a', 'a', 'b', 'a']
    reverseString(chars)
    expect(chars).toEqual(['a', 'b', 'a', 'a'])
  })

  // The case a solution that builds and returns a new array gets wrong: the
  // caller never sees the return value, only the array it handed over.
  it('mutates the array it was given rather than a copy', () => {
    const chars = ['1', '2', '3']
    const sameReference = chars
    reverseString(chars)
    expect(sameReference).toEqual(['3', '2', '1'])
  })

  // Compared through `firstDifference` rather than `toEqual` on purpose: a
  // 100k-element mismatch printed in full is unreadable *and* scrolls every other
  // failure in this file off screen, so the one case that fails loudest hides the
  // rest. See `test-utils/sequence.ts`.
  it('reverses a long array', () => {
    const source = Array.from({ length: 100_000 }, (_, i) => String(i % 10))
    const chars = [...source]
    reverseString(chars)
    expect(firstDifference(chars, [...source].reverse())).toBeNull()
  })
})
