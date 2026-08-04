import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'
import { seededTrials } from '../../../test-utils/random'
import { sortColors } from './solution'

/**
 * Wrap a plain array in `get`/`set` accessors, instrumented two ways:
 *
 * - `gets()` / `sets()` — total call counts, via `countCalls`.
 * - `getsBeforeFirstSet()` — how many `get` calls happened before the very
 *   first `set` call (or `null` if `set` was never called at all).
 *
 * The second number is the one that matters here. A solution that reads the
 * whole collection before writing anything racks up `getsBeforeFirstSet`
 * equal to (or very close to) `n`, no matter how the read phase itself is
 * written or how cheap each individual read is. The budgets below are set
 * tight enough to reject that shape while leaving room for approaches that
 * don't have it. See `solutions/in-place-array/sort-colors.md` (spoiler)
 * for the measured numbers behind the budgets below.
 */
function oracleFor(arr: number[]) {
  let getCount = 0
  let setCount = 0
  let getsBeforeFirstSet: number | null = null
  let sawSet = false

  const get = countCalls((i: number) => {
    getCount += 1
    return arr[i]!
  })
  const set = countCalls((i: number, v: number) => {
    if (!sawSet) {
      getsBeforeFirstSet = getCount
      sawSet = true
    }
    setCount += 1
    arr[i] = v
  })

  return {
    get: get.fn,
    set: set.fn,
    gets: () => getCount,
    sets: () => setCount,
    getsBeforeFirstSet: () => getsBeforeFirstSet,
    snapshot: () => arr.slice(),
  }
}

function multiset(arr: number[]): number[] {
  return [0, 1, 2].map((v) => arr.filter((x) => x === v).length)
}

function isSorted(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) if (arr[i - 1]! > arr[i]!) return false
  return true
}

describe('sortColors — correctness', () => {
  it('sorts an already-sorted array', () => {
    const input = [0, 0, 1, 1, 2, 2]
    const oracle = oracleFor(input.slice())
    const result = sortColors(input.length, oracle.get, oracle.set)
    expect(result).toBeUndefined()
    expect(oracle.snapshot()).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('sorts a reverse-sorted array', () => {
    const input = [2, 2, 1, 1, 0, 0]
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('handles an array of all 0s', () => {
    const input = [0, 0, 0, 0]
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([0, 0, 0, 0])
  })

  it('handles an array of all 1s', () => {
    const input = [1, 1, 1, 1]
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([1, 1, 1, 1])
  })

  it('handles an array of all 2s', () => {
    const input = [2, 2, 2, 2]
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([2, 2, 2, 2])
  })

  it('handles an empty array', () => {
    const oracle = oracleFor([])
    const result = sortColors(0, oracle.get, oracle.set)
    expect(result).toBeUndefined()
    expect(oracle.snapshot()).toEqual([])
  })

  it('handles a single element', () => {
    const oracle = oracleFor([1])
    sortColors(1, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([1])
  })

  it('handles two elements', () => {
    const oracle = oracleFor([2, 0])
    sortColors(2, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([0, 2])
  })

  it('handles an array with no 1s at all', () => {
    const input = [2, 0, 2, 0, 0, 2, 0, 2]
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    expect(oracle.snapshot()).toEqual([0, 0, 0, 0, 2, 2, 2, 2])
  })

  it('preserves the multiset of labels, not just the sortedness', () => {
    // Catches a solution that writes plausible-looking output built from the
    // wrong counts (e.g. always emitting an equal split) rather than the
    // labels actually present.
    const input = [2, 2, 2, 0, 1]
    const before = multiset(input)
    const oracle = oracleFor(input.slice())
    sortColors(input.length, oracle.get, oracle.set)
    const out = oracle.snapshot()
    expect(isSorted(out)).toBe(true)
    expect(multiset(out)).toEqual(before)
  })
})

describe('sortColors — randomised trials', () => {
  const SEED = 0x50c0_10c5
  const TRIALS = 40

  it('sorts correctly across many random fixtures', () => {
    seededTrials(SEED, TRIALS, (rand, trial) => {
      const n = 1 + Math.floor(rand() * 40)
      const input = Array.from({ length: n }, () => Math.floor(rand() * 3))
      const before = multiset(input)
      const oracle = oracleFor(input.slice())
      sortColors(n, oracle.get, oracle.set)
      const out = oracle.snapshot()
      expect(isSorted(out), `trial ${trial}/${TRIALS}`).toBe(true)
      expect(multiset(out), `trial ${trial}/${TRIALS}`).toEqual(before)
    })
  })
})

describe('sortColors — access budget', () => {
  // Two independent budgets, both asserted on every trial:
  //
  // - INTERLEAVE_BUDGET caps get() calls before the first set() call. A
  //   solution that fully characterises the collection before writing
  //   anything back — count the labels, then overwrite from the counts —
  //   always drives this to n. A solution that writes as it goes keeps it
  //   small. This is the budget that actually enforces "don't count first
  //   and overwrite"; see solutions/in-place-array/sort-colors.md for the
  //   measured numbers.
  // - TOTAL_BUDGET caps total get()+set() calls, to rule out anything
  //   quadratic (e.g. a comparison sort implemented directly against these
  //   accessors) that happens to interleave its reads and writes and so
  //   slips past the first budget.
  const INTERLEAVE_BUDGET = 50
  const TOTAL_BUDGET = 3000
  const SEED = 0x5eed_c010
  const TRIALS = 30

  it('stays within budget on large randomized fixtures', () => {
    const n = 500

    seededTrials(SEED, TRIALS, (rand, trial) => {
      const input = Array.from({ length: n }, () => Math.floor(rand() * 3))
      const before = multiset(input)
      const oracle = oracleFor(input.slice())

      sortColors(n, oracle.get, oracle.set)

      const out = oracle.snapshot()
      expect(isSorted(out), `trial ${trial}/${TRIALS}`).toBe(true)
      expect(multiset(out), `trial ${trial}/${TRIALS}`).toEqual(before)

      const beforeFirstSet = oracle.getsBeforeFirstSet()
      if (beforeFirstSet !== null) {
        assertWithinBudget(
          beforeFirstSet,
          INTERLEAVE_BUDGET,
          `get() calls before first set() [trial ${trial}/${TRIALS}, seed 0x${SEED.toString(16)}]`,
        )
      }

      assertWithinBudget(
        oracle.gets() + oracle.sets(),
        TOTAL_BUDGET,
        `total get()/set() calls [trial ${trial}/${TRIALS}, seed 0x${SEED.toString(16)}]`,
      )
    })
  })
})
