import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { KthLargest } from './solution'

describe('KthLargest — correctness', () => {
  it('tracks the canonical example', () => {
    const kth = new KthLargest(3, [4, 5, 8, 2])
    expect(kth.add(3)).toBe(4)
    expect(kth.add(5)).toBe(5)
    expect(kth.add(10)).toBe(5)
    expect(kth.add(9)).toBe(8)
    expect(kth.add(4)).toBe(8)
  })

  it('handles k = 1 (the running maximum)', () => {
    const kth = new KthLargest(1, [3])
    expect(kth.add(5)).toBe(5)
    expect(kth.add(2)).toBe(5)
    expect(kth.add(10)).toBe(10)
  })

  it('reports the smallest value seen so far before k values exist', () => {
    const kth = new KthLargest(4, [])
    expect(kth.add(1)).toBe(1) // 1 seen  (< k) -> smallest seen
    expect(kth.add(9)).toBe(1) // 2 seen  (< k) -> smallest seen
    expect(kth.add(2)).toBe(1) // 3 seen  (< k) -> smallest seen
    expect(kth.add(6)).toBe(1) // 4 seen  (== k) -> 4th largest == min of all 4
    expect(kth.add(20)).toBe(2) // [20, 9, 6, 2, 1] -> 4th largest is 2
  })

  it('counts duplicates rather than collapsing them', () => {
    // Seen values are [5, 5, 5]; the 2nd largest ENTRY is 5, not some
    // lower "2nd distinct value". A solution that dedupes internally
    // would answer 1 here instead of 5.
    const kth = new KthLargest(2, [5, 5, 5])
    expect(kth.add(1)).toBe(5) // seen: [5,5,5,1] -> desc [5,5,5,1], 2nd = 5
    expect(kth.add(1)).toBe(5) // seen adds 1 -> desc [5,5,5,1,1], 2nd = 5
    expect(kth.add(6)).toBe(5) // seen adds 6 -> desc [6,5,5,5,1,1], 2nd = 5
    expect(kth.add(6)).toBe(6) // seen adds 6 -> desc [6,6,5,5,5,1,1], 2nd = 6
  })

  it('handles a stream where every value is equal', () => {
    const kth = new KthLargest(3, [7, 7, 7, 7])
    expect(kth.add(7)).toBe(7)
    expect(kth.add(7)).toBe(7)
  })

  it('handles negative values', () => {
    const kth = new KthLargest(2, [-5, -10, -3])
    expect(kth.add(-1)).toBe(-3) // seen: [-5,-10,-3,-1] -> desc [-1,-3,-5,-10]
    expect(kth.add(-20)).toBe(-3) // seen adds -20, 2nd largest still -3
    expect(kth.add(0)).toBe(-1) // seen adds 0, desc [0,-1,-3,-5,-10,-20]
  })

  it('does not answer with the running maximum when k > 1', () => {
    // A solution that just tracks the single largest value seen would
    // answer 8 for every call below once 8 has appeared, instead of the
    // true 3rd-largest.
    const kth = new KthLargest(3, [1, 2, 3])
    expect(kth.add(8)).toBe(2) // seen: [1,2,3,8] -> desc [8,3,2,1], 3rd = 2
    expect(kth.add(9)).toBe(3) // seen adds 9 -> desc [9,8,3,2,1], 3rd = 3
    expect(kth.add(4)).toBe(4) // seen adds 4 -> desc [9,8,4,3,2,1], 3rd = 4
  })
})

describe('KthLargest — scale', () => {
  /**
   * A brute force that re-sorts the entire history on every `add` is
   * O(m * n log n) for m adds against a history that grows to size n. With
   * an initial history of INITIAL_SIZE and ADDS further calls, the history
   * grows past 100,000 entries and there are 100,000 more sorts to do —
   * on the order of 10^11 comparisons in total. Measured: the re-sorting
   * version was still running after four minutes and had to be killed, against
   * 34ms for the reference approach.
   *
   * The 5s budget asserted below is what fails it, NOT the 10s testTimeout —
   * Vitest cannot preempt synchronous JavaScript, so a blocking brute force
   * runs to completion and only then reports. See "AGENTS.md" > "Tests
   * encode the insight".
   *
   * The stream is generated deterministically via `mulberry32` so the
   * suite is reproducible. Expected values are NOT computed by re-running
   * the reference approach — that would just be testing the
   * implementation against itself. Instead, at a handful of checkpoints
   * scattered through the run, the full history collected so far (kept in
   * a plain array alongside the class under test) is independently sorted
   * from scratch with `Array.prototype.sort`, and the k-th entry of that
   * sort is compared against what `add` returned at that exact call. A
   * full sort is a different computation from maintaining a running
   * structure incrementally, so this check does not simply mirror the
   * approach being tested — and it stays cheap because it only runs at a
   * few checkpoints, not on every call.
   */
  it('finishes well within budget on a large stream and matches independently-sorted checkpoints', () => {
    const K = 500
    const INITIAL_SIZE = 2_000
    const ADDS = 100_000
    const SEED = 0xfeed_1234
    const VALUE_RANGE = 1_000_000

    const rand = mulberry32(SEED)

    const initial = Array.from({ length: INITIAL_SIZE }, () =>
      Math.floor(rand() * VALUE_RANGE),
    )
    const history = initial.slice()

    const kth = new KthLargest(K, initial.slice())

    const checkpoints = new Set([1, 100, 1_000, 10_000, 50_000, ADDS])

    const t0 = performance.now()
    for (let i = 1; i <= ADDS; i++) {
      const val = Math.floor(rand() * VALUE_RANGE)
      history.push(val)
      const result = kth.add(val)

      if (checkpoints.has(i)) {
        const sortedDesc = history.slice().sort((a, b) => b - a)
        const expected = sortedDesc[K - 1]!
        expect(result).toBe(expected)
      }
    }
    const elapsed = performance.now() - t0

    expect(elapsed).toBeLessThan(5000)
  })
})
