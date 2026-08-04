import { describe, expect, it } from 'vitest'
import { minEatingSpeed } from './solution'

describe('minEatingSpeed — correctness', () => {
  it('handles the canonical mixed example', () => {
    expect(minEatingSpeed([3, 6, 7, 11], 8)).toBe(4)
  })

  it('handles a tight hour budget equal to the pile count', () => {
    // h == piles.length: only one hour per pile is available, so the speed
    // has to clear the largest pile in a single hour. This also catches an
    // off-by-one at the top of a search range — the answer sits exactly at
    // max(piles), not one above or below it.
    expect(minEatingSpeed([30, 11, 23, 4, 20], 5)).toBe(30)
  })

  it('handles a slightly looser hour budget', () => {
    expect(minEatingSpeed([30, 11, 23, 4, 20], 6)).toBe(23)
  })

  it('handles a single pile that does not divide evenly', () => {
    // ceil(10/4) = 3 <= 3, but ceil(10/3) = 4 > 3 — a solution that floors
    // instead of ceiling the per-pile hours would accept k=3 and return the
    // wrong (too small) answer here.
    expect(minEatingSpeed([10], 3)).toBe(4)
  })

  it('handles a pile of size 1', () => {
    expect(minEatingSpeed([1], 5)).toBe(1)
  })

  it('handles an hour budget far larger than necessary', () => {
    // Eating everything at speed 1 costs sum(piles) = 27 hours, well under
    // h = 1000, so speed 1 already finishes in time. A solution that
    // returns max(piles) unconditionally would answer 11 here instead of 1.
    expect(minEatingSpeed([3, 6, 7, 11], 1000)).toBe(1)
  })
})

describe('minEatingSpeed — scale', () => {
  // No expensive oracle exists here (unlike celebrity's knows()), so the
  // discriminator is wall-clock: an input large enough that scanning
  // candidate speeds upward from 1 cannot finish inside Vitest's 10s
  // timeout, while a reference solution finishes in well under a second.
  //
  // The trap with a scale test built from a big array is that the array
  // itself dominates runtime for every approach, drowning out the
  // difference between candidate strategies. Here the search space isn't
  // the array at all — it's the answer, 1..max(piles) — so the array can
  // stay tiny and the pile sizes can be enormous instead. A handful of
  // huge, equal piles forces the answer itself up near max(piles): with
  // h == piles.length, every pile must finish in its own single hour, so
  // the minimum speed is exactly the largest pile. A linear scan upward
  // from 1 then has to walk essentially the whole 1..max(piles) range
  // before it lands on a working speed, while the reference approach stays
  // cheap regardless.
  const PILE_SIZE = 6_000_000_000
  const PILE_COUNT = 5

  it('finishes a few enormous piles well within budget', () => {
    const piles = Array<number>(PILE_COUNT).fill(PILE_SIZE)
    const h = PILE_COUNT

    const start = performance.now()
    const result = minEatingSpeed(piles, h)
    const elapsedMs = performance.now() - start

    expect(result).toBe(PILE_SIZE)

    // The reference solution finishes in well under a second; a linear
    // scan of candidate speeds cannot finish this input inside Vitest's
    // 10s timeout at all, so this bound is not tight against the
    // reference — it exists as a sanity ceiling, and the timeout is the
    // real backstop against the brute force.
    expect(elapsedMs).toBeLessThan(5000)
  })
})
