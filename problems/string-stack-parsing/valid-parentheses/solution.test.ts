import { describe, expect, it } from 'vitest'
import { isBalanced } from './solution'

describe('isBalanced — correctness', () => {
  it('accepts brackets closed in sequence', () => {
    expect(isBalanced('()[]{}')).toBe(true)
  })

  it('accepts brackets closed inside out', () => {
    expect(isBalanced('([{}])')).toBe(true)
  })

  it('accepts the empty string', () => {
    expect(isBalanced('')).toBe(true)
  })

  it('rejects a closing bracket of the wrong kind', () => {
    expect(isBalanced('(]')).toBe(false)
    expect(isBalanced('{)')).toBe(false)
  })

  // The case that separates order-aware matching from merely counting each
  // kind: the counts all balance, the nesting does not.
  it('rejects correct counts closed in the wrong order', () => {
    expect(isBalanced('([)]')).toBe(false)
    expect(isBalanced('{[(})]')).toBe(false)
  })

  it('rejects an unclosed opening bracket', () => {
    expect(isBalanced('(')).toBe(false)
    expect(isBalanced('([]')).toBe(false)
  })

  it('rejects a closing bracket with nothing open', () => {
    expect(isBalanced(')')).toBe(false)
    expect(isBalanced('()]')).toBe(false)
  })

  it('handles deep nesting of one kind', () => {
    expect(isBalanced('((((((()))))))')).toBe(true)
    expect(isBalanced('(((((((())))))')).toBe(false)
  })
})

describe('isBalanced — scale', () => {
  /**
   * The natural brute force is to keep sweeping the string deleting adjacent
   * matched pairs — `()`, `[]`, `{}` — until nothing changes, then check whether
   * anything is left. It is correct, and it is quadratic: a fully nested string
   * exposes only its innermost pair per sweep, so it needs n/2 sweeps of O(n)
   * work each.
   *
   * At 100,000 levels of nesting that is 10^10 character visits, measured here
   * at 33 seconds, against a few milliseconds for a single left-to-right pass.
   *
   * Fully nested rather than random, deliberately: a random mix would let a
   * removal-based approach collapse most of the string in the first few sweeps
   * and slip under the budget. Nesting is its worst case.
   */
  it('finishes well within budget on a deeply nested balanced string', () => {
    const DEPTH = 100_000
    const text = '('.repeat(DEPTH) + ')'.repeat(DEPTH)

    const t0 = performance.now()
    const result = isBalanced(text)
    const elapsed = performance.now() - t0

    expect(result).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * The same shape, but the very last character is wrong — so nothing can
   * conclude early from a prefix.
   */
  it('finishes well within budget when a deeply nested string fails at the last character', () => {
    const DEPTH = 100_000
    const text = '('.repeat(DEPTH) + ')'.repeat(DEPTH - 1) + ']'

    const t0 = performance.now()
    const result = isBalanced(text)
    const elapsed = performance.now() - t0

    expect(result).toBe(false)
    expect(elapsed).toBeLessThan(5000)
  })
})
