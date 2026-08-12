/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `AGENTS.md` says a drill is only worth doing if it does. This
 * one cannot: there is no asymptotically-worse-but-correct approach to reject.
 * The obvious solution is the only solution, which is exactly why it is here —
 * see "AGENTS.md" > "The warm-up tier" for why that exemption exists.
 */

import { describe, expect, it } from 'vitest'
import { isAnagram } from './solution'

describe('isAnagram — correctness', () => {
  it('accepts a rearrangement', () => {
    expect(isAnagram('anagram', 'nagaram')).toBe(true)
  })

  it('rejects different letters', () => {
    expect(isAnagram('rat', 'car')).toBe(false)
  })

  // Same letter set, different counts — the case a set-based solution gets wrong.
  it('rejects the same letters at different counts', () => {
    expect(isAnagram('aab', 'abb')).toBe(false)
    expect(isAnagram('aa', 'a')).toBe(false)
  })

  it('rejects different lengths', () => {
    expect(isAnagram('abc', 'abcd')).toBe(false)
  })

  // Every other rejection above also mismatches on the *last* letter examined, so
  // an answer that overwrites its verdict each iteration instead of returning
  // early still passes them. Here 'a' and 'b' mismatch and 'c' matches, so only
  // a solution that keeps the earlier disagreement gets this right.
  it('rejects a mismatch that agrees on the last letter', () => {
    expect(isAnagram('abbc', 'aabc')).toBe(false)
  })

  it('accepts two empty strings', () => {
    expect(isAnagram('', '')).toBe(true)
  })

  // The constraints allow a length of zero, so one empty string is a legal input
  // and is never an anagram of a non-empty one. A falsy guard on either argument
  // returns true here.
  it('rejects one empty string against a non-empty one', () => {
    expect(isAnagram('', 'abc')).toBe(false)
    expect(isAnagram('abc', '')).toBe(false)
  })

  it('accepts a string against itself', () => {
    expect(isAnagram('abc', 'abc')).toBe(true)
  })

  it('handles a long pair', () => {
    const a = 'abcde'.repeat(10_000)
    const b = 'edcba'.repeat(10_000)
    expect(isAnagram(a, b)).toBe(true)
    expect(isAnagram(a, b.slice(0, -1) + 'z')).toBe(false)
  })
})
