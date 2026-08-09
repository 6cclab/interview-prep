/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: there is no asymptotically-worse-but-correct approach to reject.
 * The obvious solution is the only solution, which is exactly why it is here —
 * see ".claude/CLAUDE.md" > "The warm-up tier" for why that exemption exists.
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

  it('accepts two empty strings', () => {
    expect(isAnagram('', '')).toBe(true)
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
