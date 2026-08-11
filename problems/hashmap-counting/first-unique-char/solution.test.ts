/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one deliberately does not, and the reason is specific: the alphabet is fixed
 * at 26 letters, so scanning the string once per distinct letter is O(26n) —
 * a constant factor, not a worse order of growth. There is no honest cost gap
 * to assert, and a suite that timed the difference would be measuring the
 * machine. See ".claude/CLAUDE.md" > "The warm-up tier".
 *
 * What it does test hard is *first*: several cases have a unique character that
 * is not the earliest-looking candidate.
 */

import { describe, expect, it } from 'vitest'
import { firstUniqChar } from './solution'

describe('firstUniqChar — correctness', () => {
  it('finds a unique character at the start', () => {
    expect(firstUniqChar('leetcode')).toBe(0)
  })

  it('skips characters that repeat later in the string', () => {
    expect(firstUniqChar('loveleetcode')).toBe(2)
  })

  it('returns -1 when every character repeats', () => {
    expect(firstUniqChar('aabb')).toBe(-1)
    expect(firstUniqChar('abab')).toBe(-1)
  })

  it('returns -1 for an empty string', () => {
    expect(firstUniqChar('')).toBe(-1)
  })

  it('handles a single character', () => {
    expect(firstUniqChar('z')).toBe(0)
  })

  it('finds a unique character at the very end', () => {
    expect(firstUniqChar('aabbc')).toBe(4)
  })

  // A solution that returns the first character whose *next* occurrence is
  // absent, rather than checking the whole string, gets this wrong: the unique
  // character appears after its own repeated neighbours.
  it('returns the earliest unique index, not the earliest single-looking one', () => {
    expect(firstUniqChar('cabbac')).toBe(-1)
    expect(firstUniqChar('cabbacd')).toBe(6)
    expect(firstUniqChar('abcabd')).toBe(2)
  })

  it('handles a character repeated three or more times', () => {
    expect(firstUniqChar('aaabcccd')).toBe(3)
  })

  it('handles a long string with a unique character in the middle', () => {
    const half = 'ab'.repeat(25_000)
    expect(firstUniqChar(`${half}z${half}`)).toBe(50_000)
  })

  it('handles a long string with no unique character', () => {
    expect(firstUniqChar('abcde'.repeat(20_000))).toBe(-1)
  })
})
