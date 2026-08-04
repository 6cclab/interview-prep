import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { coinChange } from './solution'

describe('coinChange — correctness', () => {
  it('finds the canonical mix', () => {
    expect(coinChange([1, 2, 5], 11)).toBe(3)
  })

  it('reports unreachable totals', () => {
    expect(coinChange([2], 3)).toBe(-1)
  })

  it('needs zero coins for a zero amount', () => {
    expect(coinChange([1, 2, 5], 0)).toBe(0)
    expect(coinChange([1], 0)).toBe(0)
  })

  it('reports unreachable when every coin exceeds the amount', () => {
    expect(coinChange([5, 7], 3)).toBe(-1)
  })

  it('beats the greedy answer', () => {
    // Greedy (largest coin that fits, repeatedly) takes 4, then is stuck
    // with two 1s: 4 + 1 + 1 = 3 coins. The true optimum is 3 + 3 = 2.
    expect(coinChange([1, 3, 4], 6)).toBe(2)
  })

  it('handles a single denomination that divides the amount exactly', () => {
    expect(coinChange([7], 21)).toBe(3)
  })

  it('ignores a coin too large to ever be used', () => {
    expect(coinChange([1, 2, 5, 50], 6)).toBe(2)
  })

  it('handles unsorted coin input', () => {
    expect(coinChange([25, 10, 1], 30)).toBe(3)
  })
})

describe('coinChange — scale', () => {
  /**
   * A solution that recurses on `amount` without reusing work across
   * amounts re-derives the same subtotals over and over — the call count
   * grows exponentially with `amount` (empirically, roughly a 13-14x
   * blowup for every +5 added to the amount with coins [1, 2, 5]). At
   * amount = 2,000 that's a search space no machine finishes in this
   * lifetime. A solution that reuses work across amounts does a bounded
   * amount of work per amount and finishes in well under a second.
   *
   * `expected` isn't computed by any coin-change algorithm — it's a bound
   * argument: no coin here is worth more than 5, so any valid combination
   * needs at least amount / 5 coins, and since 2,000 is an exact multiple
   * of 5, amount / 5 coins of value 5 each hits the target exactly. The
   * lower bound is achieved, so it must be optimal.
   *
   * The random noise coins are folded in only to keep the fixture from
   * looking hand-picked; they never change the analysis above because
   * they're all still <= 5.
   */
  it('finishes well within budget on a large amount with a known-optimal count', () => {
    const rand = mulberry32(0xc0ffee)
    const noise = new Set<number>([1, 2, 5])
    while (noise.size < 5) {
      noise.add(1 + Math.floor(rand() * 5))
    }
    const coins = Array.from(noise)

    const amount = 2000
    const expected = amount / 5

    const t0 = performance.now()
    const result = coinChange(coins, amount)
    const elapsed = performance.now() - t0

    expect(result).toBe(expected)
    expect(elapsed).toBeLessThan(5000)
  })
})
