import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { maxArea } from './solution'

describe('maxArea — correctness', () => {
  it('finds the canonical container', () => {
    expect(maxArea([1, 8, 6, 2, 5, 4, 8, 3, 7])).toBe(49)
  })

  it('handles the minimum size of two lines', () => {
    expect(maxArea([1, 1])).toBe(1)
    expect(maxArea([5, 1])).toBe(1)
  })

  it('handles all-equal heights', () => {
    // Every pair ties on height, so only width can win — the two ends.
    expect(maxArea(Array(10).fill(7))).toBe(63)
  })

  it('handles strictly increasing heights', () => {
    expect(maxArea([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(25)
  })

  it('handles strictly decreasing heights', () => {
    expect(maxArea([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(25)
  })

  it('handles a zero height among the lines', () => {
    // A zero-height line can never be part of the winning pair — it always
    // contributes an area of 0 — but it still has to be walked past.
    expect(maxArea([4, 0, 3, 2, 5, 1])).toBe(16)
  })
})

describe('maxArea — scale', () => {
  /**
   * A brute force that checks every pair is O(n^2). At n = 200,000 that's
   * 2*10^10 pair evaluations, measured at 30.2s, against 6ms for the reference
   * approach. That gap is what this test is for; it is not a performance
   * micro-benchmark.
   *
   * The elapsed-time assertion below is what fails it, NOT the 10s testTimeout
   * — Vitest cannot preempt synchronous JavaScript. See ".claude/CLAUDE.md" >
   * "Tests encode the insight".
   *
   * The array can't just be n random numbers, though — with no way to
   * independently compute the true maximum at this size, there would be
   * nothing to assert against. Instead the array is built with a known
   * answer baked in: low, bounded noise everywhere (heights 0-4, generated
   * deterministically via `mulberry32` so the suite stays reproducible),
   * plus two much taller spikes planted far apart. The spikes' area
   * (SPIKE * their distance) is many orders of magnitude larger than any
   * area the noise alone could produce (noise area is bounded above by
   * 4 * (n-1)), so the maximum is known by construction regardless of how
   * the noise happens to land.
   */
  it('finishes well within budget on a large array with a known-best pair', () => {
    const N = 200_000
    const SEED = 0xc0ffee
    const rand = mulberry32(SEED)

    const heights = new Array<number>(N)
    for (let i = 0; i < N; i++) heights[i] = Math.floor(rand() * 5)

    const i0 = Math.floor(N * 0.2)
    const j0 = N - 1 - Math.floor(N * 0.2)
    const SPIKE = 10_000_000
    heights[i0] = SPIKE
    heights[j0] = SPIKE

    const expected = SPIKE * (j0 - i0)

    const t0 = performance.now()
    const result = maxArea(heights)
    const elapsed = performance.now() - t0

    expect(result).toBe(expected)
    expect(elapsed).toBeLessThan(5000)
  })
})
