import { describe, expect, it } from 'vitest'
import { dailyTemperatures } from './solution'

describe('dailyTemperatures — correctness', () => {
  it('handles the canonical mixed example', () => {
    expect(dailyTemperatures([73, 74, 75, 71, 69, 72, 76, 73])).toEqual([
      1, 1, 4, 2, 1, 1, 0, 0,
    ])
  })

  it('handles a strictly increasing run — every day waits exactly one', () => {
    expect(dailyTemperatures([30, 40, 50, 60])).toEqual([1, 1, 1, 0])
  })

  it('handles a strictly decreasing run — nobody ever gets warmer', () => {
    expect(dailyTemperatures([60, 50, 40, 30])).toEqual([0, 0, 0, 0])
  })

  it('handles all-equal readings — ties never count as warmer', () => {
    // Catches solutions that compare with >= instead of >: a tie must
    // leave both days waiting, not resolve either one.
    expect(dailyTemperatures([50, 50, 50, 50])).toEqual([0, 0, 0, 0])
  })

  it('handles a single day', () => {
    expect(dailyTemperatures([50])).toEqual([0])
  })

  it('handles two days, cooler then warmer', () => {
    expect(dailyTemperatures([50, 60])).toEqual([1, 0])
  })

  it('handles two days, warmer then cooler', () => {
    expect(dailyTemperatures([60, 50])).toEqual([0, 0])
  })
})

describe('dailyTemperatures — scale', () => {
  // No expensive oracle exists here (unlike celebrity's knows()), so the
  // discriminator is wall-clock: an input large enough that a per-day forward
  // scan takes tens of seconds, while the reference approach finishes in
  // milliseconds. Measured: 17.1s for the forward scan.
  //
  // The elapsed-time assertion at the bottom is what fails it, NOT the 10s
  // testTimeout — Vitest cannot preempt synchronous JavaScript, so a blocking
  // brute force runs to completion and only then reports. See
  // "AGENTS.md" > "Tests encode the insight".
  //
  // Random data defeats this: a forward scan from day i usually hits a
  // warmer day within a few steps, so the naive solution behaves close to
  // linear in practice even though its worst case is quadratic. To force
  // the quadratic case to actually happen, the fixture below is a strictly
  // decreasing run — every day is cooler than every day before it, so a
  // forward scan from day i finds nothing until the very last day — capped
  // by a single spike at the end that is warmer than everything.
  //
  // That gives day i a forward scan of length (N-1-i) with no early exit,
  // so total work is ~N^2/2 comparisons. It also gives an
  // analytically-known expected result without needing a second
  // implementation to check against: every day i < N-1 waits until the
  // spike, i.e. answer[i] = N-1-i, and the spike itself waits 0.
  const N = 300_000

  function buildDecreasingWithSpike(n: number): number[] {
    const temps = new Array<number>(n)
    for (let i = 0; i < n - 1; i++) temps[i] = n - i // strictly decreasing
    temps[n - 1] = n + 1 // warmer than every prior day
    return temps
  }

  it('finishes a strictly-decreasing-plus-spike input well within budget', () => {
    const temps = buildDecreasingWithSpike(N)

    const start = performance.now()
    const result = dailyTemperatures(temps)
    const elapsedMs = performance.now() - start

    expect(result).toHaveLength(N)
    // Every day is checked, but only a mismatch reaches `expect`. 300,000
    // assertion calls cost about a second — an order of magnitude more than the
    // reference solution itself, which would shrink the very gap this test
    // exists to demonstrate.
    let mismatch = -1
    for (let i = 0; i < N - 1; i++) {
      if (result[i] !== N - 1 - i) {
        mismatch = i
        break
      }
    }
    expect(mismatch).toBe(-1)
    expect(result[N - 1]).toBe(0)

    // Not tight against the reference, which finishes in milliseconds — this
    // is a sanity ceiling, and it is the only thing standing between a
    // 17-second forward scan and a green suite.
    expect(elapsedMs).toBeLessThan(5000)
  })
})
