import { describe, expect, it } from 'vitest'
import { countNQueens } from './solution'

describe('countNQueens — correctness', () => {
  it('handles the trivial single-queen board', () => {
    expect(countNQueens(1)).toBe(1)
  })

  it('has no solution on a 2x2 board', () => {
    expect(countNQueens(2)).toBe(0)
  })

  it('has no solution on a 3x3 board', () => {
    expect(countNQueens(3)).toBe(0)
  })

  it('matches the known count on a 4x4 board', () => {
    expect(countNQueens(4)).toBe(2)
  })

  it('matches the known count on a 5x5 board', () => {
    expect(countNQueens(5)).toBe(10)
  })

  it('matches the known count on a 6x6 board', () => {
    expect(countNQueens(6)).toBe(4)
  })

  it('matches the known count on the classic 8x8 board', () => {
    expect(countNQueens(8)).toBe(92)
  })
})

describe('countNQueens — scale', () => {
  /**
   * A solution that builds every full placement of n queens (one per row,
   * say, picking any of n columns independently) and only checks validity
   * once each placement is complete has to walk n^n candidates before it
   * can rule any of them out. At n = 12 that's 12^12 (~8.9 * 10^12)
   * candidates, each needing a pairwise check across all queens on top —
   * nowhere close to finishing inside Vitest's timeout, while this drill's
   * intended solution finishes the same board in well under a second.
   *
   * Vitest's `testTimeout` does not reliably preempt a synchronous
   * CPU-bound loop, so the budget below is measured explicitly with
   * `performance.now()` rather than relied upon implicitly.
   */
  it('finishes well within budget on a 12x12 board', () => {
    const t0 = performance.now()
    const result = countNQueens(12)
    const elapsed = performance.now() - t0

    expect(result).toBe(14200)
    expect(elapsed).toBeLessThan(5000)
  })
})
