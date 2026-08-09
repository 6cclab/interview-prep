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
import { isPalindrome } from './solution'

describe('isPalindrome — correctness', () => {
  it('ignores punctuation, spaces and case', () => {
    expect(isPalindrome('A man, a plan, a canal: Panama')).toBe(true)
  })

  it('rejects a non-palindrome', () => {
    expect(isPalindrome('race a car')).toBe(false)
  })

  it('treats a string with nothing to compare as a palindrome', () => {
    expect(isPalindrome('')).toBe(true)
    expect(isPalindrome(' ')).toBe(true)
    expect(isPalindrome('.,!')).toBe(true)
  })

  it('handles a single character', () => {
    expect(isPalindrome('a')).toBe(true)
  })

  // '0' (48) and 'P' (80) are exactly 32 apart, the same distance as 'A' and
  // 'a' — so a case-insensitive comparison built on "differ by 32" rather than
  // on character class calls them equal and reports true here.
  it('does not conflate digits with letters', () => {
    expect(isPalindrome('0P')).toBe(false)
  })

  it('handles digits as content', () => {
    expect(isPalindrome('1a2a1')).toBe(true)
    expect(isPalindrome('12321')).toBe(true)
    expect(isPalindrome('123')).toBe(false)
  })

  it('handles an even-length palindrome', () => {
    expect(isPalindrome('abba')).toBe(true)
    expect(isPalindrome('abab')).toBe(false)
  })

  it('handles a long string', () => {
    const half = 'ab1'.repeat(30_000)
    const reversed = half.split('').reverse().join('')
    expect(isPalindrome(half + reversed)).toBe(true)
    expect(isPalindrome(half + '#' + reversed)).toBe(true)
    expect(isPalindrome(half + 'z' + reversed)).toBe(false)
  })
})
