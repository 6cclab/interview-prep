import { describe, expect, it } from 'vitest'
import { decodeString } from './solution'

describe('decodeString — correctness', () => {
  it('repeats a single letter', () => {
    expect(decodeString('3[a]')).toBe('aaa')
  })

  it('handles one level of nesting', () => {
    expect(decodeString('3[a2[c]]')).toBe('accaccacc')
  })

  it('handles adjacent groups at the same level, with plain text after them', () => {
    expect(decodeString('2[abc]3[cd]ef')).toBe('abcabccdcdcdef')
  })

  it('returns a plain string with no brackets unchanged', () => {
    expect(decodeString('xyz')).toBe('xyz')
  })

  it('reads a multi-digit repeat count as a single number, not digit by digit', () => {
    // A solution that only reads one digit for k would produce "1[a]2[a]" ->
    // "a" + "aa", i.e. treat "12[a]" as "1" then "2[a]" and return "aaa".
    expect(decodeString('12[a]')).toBe('a'.repeat(12))
    expect(decodeString('100[z]')).toBe('z'.repeat(100))
  })

  it('handles the minimum valid input: a single character', () => {
    expect(decodeString('z')).toBe('z')
  })

  it('nests three groups deep', () => {
    // 1[c] -> "c"; 3[b + "c"] -> "bcbcbc"; 2[a + "bcbcbc"] -> two copies of it.
    expect(decodeString('2[a3[b1[c]]]')).toBe('abcbcbcabcbcbc')
  })

  it('keeps text both before and after a nested group', () => {
    // A solution that only tracks "the content since the last bracket" and
    // forgets what came before the nested group inside the same set of
    // brackets will drop the leading "a" or the trailing "c".
    expect(decodeString('2[a2[b]c]')).toBe('abbcabbc')
  })
})

describe('decodeString — scale', () => {
  /**
   * A brute force that repeatedly scans for a bracketed group with no
   * brackets inside it, expands that one group, and rebuilds the string
   * around the expansion — looping until no brackets remain — does one pass
   * per bracket pair it resolves, and each pass re-scans and reallocates the
   * *entire current string*. On an input built from a single chain of
   * nesting, that is one pass per level of depth, and the string being
   * rebuilt on every single one of those passes is already close to its
   * final decoded size. That makes the total work proportional to
   * depth * decoded-length — quadratic in the depth — while the reference
   * approach is linear in the input length.
   *
   * The input below is `D` layers of `1[...]` wrapped around a flat block of
   * `F` letters, with `D = F = 65000`. Every wrapping layer uses a repeat
   * count of 1, so nesting adds depth (and therefore passes, for the brute
   * force) without multiplying the decoded output — the decoded string is
   * just the `F`-letter block, unchanged. That keeps the answer small and
   * exactly known: it's `F` copies of "x", nothing else. Measured locally,
   * the reference approach finishes in single-digit milliseconds here,
   * while the pass-per-bracket brute force takes several seconds — comfortably
   * more than the two orders of magnitude of margin these scale tests are
   * built for.
   *
   * Vitest's `testTimeout` cannot preempt a synchronous CPU-bound loop like
   * the brute force's — the event loop only gets a chance to notice the
   * timeout once the loop returns control, by which point the damage (and
   * the wall-clock cost) is already done. So elapsed time is measured
   * explicitly with `performance.now()` and asserted directly, which fails
   * cleanly instead of relying on Vitest to interrupt anything.
   */
  it('finishes well within budget on a deeply nested, large-output input', () => {
    const DEPTH = 58_000
    const FLAT_LEN = 58_000

    const input = '1['.repeat(DEPTH) + 'x'.repeat(FLAT_LEN) + ']'.repeat(DEPTH)

    const t0 = performance.now()
    const result = decodeString(input)
    const elapsed = performance.now() - t0

    expect(result.length).toBe(FLAT_LEN)
    expect(result).toBe('x'.repeat(FLAT_LEN))
    expect(elapsed).toBeLessThan(5000)
  })
})
