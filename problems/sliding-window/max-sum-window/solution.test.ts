import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { maxWindowSum } from './solution'

describe('maxWindowSum — correctness', () => {
  it('finds the best window', () => {
    expect(maxWindowSum([1, 4, 2, 10, 2, 3, 1, 0, 20], 4)).toBe(24)
  })

  it('handles a window of one', () => {
    expect(maxWindowSum([3, 9, 2], 1)).toBe(9)
  })

  it('handles a window covering the whole array', () => {
    expect(maxWindowSum([1, 2, 3], 3)).toBe(6)
  })

  it('is null when the window does not fit', () => {
    expect(maxWindowSum([5], 3)).toBeNull()
    expect(maxWindowSum([1, 2], 3)).toBeNull()
  })

  // With every value negative the answer is negative too, so a solution that
  // starts its running maximum at 0 reports 0 here.
  it('handles an all-negative array', () => {
    expect(maxWindowSum([-3, -1, -4, -2], 2)).toBe(-4)
    expect(maxWindowSum([-3, -1, -4, -2], 1)).toBe(-1)
  })

  it('handles a mix where the best window is not the one holding the largest value', () => {
    // The 9 sits between two deep negatives; the adjacent pair of 4s beats it.
    expect(maxWindowSum([4, 4, -100, 9, -100], 2)).toBe(8)
  })

  it('finds a best window at the very end', () => {
    expect(maxWindowSum([1, 1, 1, 8, 8], 2)).toBe(16)
  })
})

describe('maxWindowSum — scale', () => {
  const N = 500_000
  const K = 250_000
  const PLATEAU = 1_000_000
  /** Where the winning run of K high values starts. Kept off both ends. */
  const AT = 120_000

  /**
   * Adding each window up from scratch costs (n - k + 1) * k additions, which
   * is maximised at k = n/2 — so the fixture sits there deliberately rather than
   * using a small window. At n = 500,000 and k = 250,000 that is 6.25*10^10
   * additions, while carrying a running sum across the array costs one addition
   * and one subtraction per position regardless of k.
   *
   * An earlier version of this fixture used n = 200,000 with k = 50,000, and the
   * from-scratch version *passed* it in about four seconds. Sizing a scale
   * fixture by eye is exactly how a suite ends up proving nothing; the measured
   * gap is in `solutions/sliding-window/max-sum-window.md`.
   *
   * The answer is known by construction rather than searched for. Background
   * values are small (0..4, deterministic via `mulberry32`), and a run of
   * exactly K values of 10^6 is planted at a fixed offset. Any window that does
   * not cover the whole plateau trades at least one plateau value for a
   * background one, losing at least 10^6 - 4, so the plateau window is the
   * unique maximum and its sum is exactly K * 10^6.
   */
  function fixture(): number[] {
    const rand = mulberry32(0xc0ffee)
    const values = Array.from({ length: N }, () => Math.floor(rand() * 5))
    for (let i = AT; i < AT + K; i++) values[i] = PLATEAU
    return values
  }

  it('finishes well within budget on a large array with a large window', () => {
    const values = fixture()

    const t0 = performance.now()
    const result = maxWindowSum(values, K)
    const elapsed = performance.now() - t0

    expect(result).toBe(K * PLATEAU)
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * The same array with a window of 2. A running sum is unaffected by k; a
   * from-scratch sum gets cheap here, which is why this case asserts the answer
   * rather than the clock — it is the correctness half of the scale fixture.
   *
   * Two adjacent plateau values are still the maximum, and the plateau is long
   * enough that such a pair exists.
   */
  it('is still correct on the large fixture with a small window', () => {
    const values = fixture()

    expect(maxWindowSum(values, 2)).toBe(2 * PLATEAU)
  })

  /**
   * A window one larger than the plateau, so the winner must include exactly one
   * background value — and it must be the largest background value adjacent to
   * either end of the plateau. Asserting a range rather than a point keeps the
   * test from depending on which of the two neighbours the PRNG produced, while
   * still rejecting an off-by-one window.
   */
  it('is correct when no window can cover only high values', () => {
    const values = fixture()
    const result = maxWindowSum(values, K + 1)

    expect(result).toBeGreaterThanOrEqual(K * PLATEAU)
    expect(result).toBeLessThanOrEqual(K * PLATEAU + 4)
  })
})
