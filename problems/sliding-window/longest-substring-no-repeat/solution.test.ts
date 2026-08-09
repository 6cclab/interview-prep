import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { lengthOfLongestSubstring } from './solution'

describe('lengthOfLongestSubstring — correctness', () => {
  it('handles a repeating pattern', () => {
    expect(lengthOfLongestSubstring('abcabcbb')).toBe(3)
  })

  it('handles a single repeated character', () => {
    expect(lengthOfLongestSubstring('bbbbb')).toBe(1)
  })

  it('handles a repeat that is not at the start', () => {
    expect(lengthOfLongestSubstring('pwwkew')).toBe(3)
  })

  it('returns 0 for an empty string', () => {
    expect(lengthOfLongestSubstring('')).toBe(0)
  })

  it('returns 1 for a single character', () => {
    expect(lengthOfLongestSubstring('x')).toBe(1)
  })

  it('returns the full length when every character is distinct', () => {
    expect(lengthOfLongestSubstring('abcdefg')).toBe(7)
  })

  it('handles two repeats separated by distance', () => {
    // "abba": the second 'a' repeats the first, then 'b' repeats the second
    // character seen — but that second 'b' was already excluded once the
    // first 'b' forced the left edge past it. An answer that tracks "last
    // seen index" but lets the left edge retreat below its current position
    // will overcount this case.
    expect(lengthOfLongestSubstring('abba')).toBe(2)
  })
})

describe('lengthOfLongestSubstring — scale', () => {
  /**
   * The naive "check every substring" approach is O(n^2) or worse no matter
   * how the inner check is written, *provided nothing lets it bail out
   * early*. A string with a small alphabet defeats that: windows stay short
   * because repeats show up constantly, so even a quadratic-shaped brute
   * force does little real work.
   *
   * This fixture removes the escape hatch: every character is distinct, so
   * there is never an early repeat to break on, and any substring-enumeration
   * approach is forced to do the full O(n^2) (or worse) amount of work. The
   * characters are drawn from a wide codepoint range (not just a-z) so a
   * 30,000-length string doesn't have to reuse any character, and they are
   * shuffled — deterministically, via `mulberry32` — purely so the fixture
   * doesn't look like a suspiciously tidy sequential run.
   *
   * At this size the reference approach finishes in low single-digit
   * milliseconds — measured at 7ms — while a genuinely quadratic scan takes
   * 15.6s: three orders of magnitude of margin.
   *
   * The elapsed-time assertion below is what fails it, NOT the 10s testTimeout
   * — Vitest cannot preempt synchronous JavaScript. See ".claude/CLAUDE.md" >
   * "Tests encode the insight".
   */
  it('finishes well within the timeout on a large, all-distinct input', () => {
    const n = 30_000
    const rng = mulberry32(0x1057_2026)
    const chars = Array.from({ length: n }, (_, i) => String.fromCodePoint(0x100 + i))
    const s = shuffled(chars, rng).join('')

    const t0 = performance.now()
    const result = lengthOfLongestSubstring(s)
    const elapsed = performance.now() - t0

    expect(result).toBe(n)
    expect(elapsed).toBeLessThan(5000)
  })
})
