import { describe, expect, it } from 'vitest'
import { assertWithinBudget } from '../../../test-utils/oracle'
import { mergeSorted } from './solution'

/** Takes at most n values, so an infinite source can be tested safely. */
function take<T>(iterable: Iterable<T>, n: number): T[] {
  const out: T[] = []
  for (const value of iterable) {
    if (out.length >= n) break
    out.push(value)
  }
  return out
}

/**
 * A source that reports how many values were actually pulled out of it.
 *
 * This is the whole cost mechanism. Laziness is not observable in the output —
 * a solution that reads everything, sorts it, and hands back the right answer
 * produces output identical to a correct one. The only difference is how much
 * it consumed, so the suite has to measure that directly.
 */
function counted(values: Iterable<number>): { source: Iterable<number>; pulls: () => number } {
  let pulls = 0
  return {
    pulls: () => pulls,
    source: {
      *[Symbol.iterator]() {
        for (const value of values) {
          pulls += 1
          yield value
        }
      },
    },
  }
}

/**
 * An effectively unbounded ascending source, to catch anything that drains
 * before yielding.
 *
 * A genuinely infinite generator would be more honest, but then a solution that
 * drains its sources would hang the run forever while growing an array until
 * the process died. The guard turns that into a message instead. Nothing
 * correct comes near the limit — these tests take single-digit values.
 */
function* countUp(start: number, step: number): Generator<number> {
  let pulled = 0
  for (let v = start; ; v += step) {
    if (++pulled > 1_000_000) {
      throw new Error(
        'countUp: a million values read from a source that never ends. This ' +
          'stands in for an infinite stream — it cannot be drained, only ' +
          'consumed as far as the caller actually needs.',
      )
    }
    yield v
  }
}

describe('mergeSorted — correctness', () => {
  it('merges the canonical example', () => {
    expect([...mergeSorted([[1, 4, 7], [2, 3], [5]])]).toEqual([1, 2, 3, 4, 5, 7])
  })

  it('handles a single source', () => {
    expect([...mergeSorted([[1, 2, 3]])]).toEqual([1, 2, 3])
  })

  it('handles no sources at all', () => {
    expect([...mergeSorted([])]).toEqual([])
  })

  it('handles every source being empty', () => {
    expect([...mergeSorted([[], [], []])]).toEqual([])
  })

  it('handles some sources being empty', () => {
    // An empty source sitting first is the version that breaks a solution
    // which seeds its state by reading one value from each without checking
    // whether there was one.
    expect([...mergeSorted([[], [2, 4], [], [1, 3], []])]).toEqual([1, 2, 3, 4])
  })

  it('keeps duplicates, across sources and within one', () => {
    expect([...mergeSorted([[5, 5], [5], [5]])]).toEqual([5, 5, 5, 5])
  })

  it('handles uneven lengths, including one source far longer than the rest', () => {
    // The short sources run dry early; the merge must keep going rather than
    // stopping at the first exhausted source.
    expect([...mergeSorted([[1], [2], [3, 4, 5, 6, 7, 8]])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('handles negative values', () => {
    expect([...mergeSorted([[-9, -2], [-5, 0], [-100]])]).toEqual([-100, -9, -5, -2, 0])
  })

  it('handles many sources', () => {
    // 1,000 sources of one value each, arriving in descending order so nothing
    // is already in place.
    const sources = Array.from({ length: 1000 }, (_, i) => [1000 - i])
    const merged = [...mergeSorted(sources)]
    expect(merged.length).toBe(1000)
    expect(merged[0]).toBe(1)
    expect(merged[999]).toBe(1000)
  })

  it('yields a fully sorted result on interleaved sources', () => {
    const a = [1, 10, 20, 30]
    const b = [2, 11, 21, 31]
    const c = [3, 12, 22, 32]
    const merged = [...mergeSorted([a, b, c])]
    expect(merged).toEqual([...a, ...b, ...c].sort((x, y) => x - y))
  })

  it('can be iterated with a plain for...of', () => {
    // Spreading is not the only way it will be consumed, and a return value
    // that is a bare generator object rather than an iterable breaks here.
    const out: number[] = []
    for (const value of mergeSorted([[1], [2]])) out.push(value)
    expect(out).toEqual([1, 2])
  })
})

describe('mergeSorted — laziness', () => {
  /**
   * The budget, not a timer. A materialise-and-sort solution is fast — it would
   * pass any wall-clock check on inputs this size — and is still wrong here,
   * because the requirement is about how much it reads, not how long it takes.
   *
   * 500 sources of 1,000 values each is 500,000 values available. Taking 10
   * should read roughly 10, plus at most one lookahead per source to prime the
   * state: 510. The budget is 520 rather than 510 so a reasonable
   * implementation is not punished for a slightly different priming strategy.
   */
  it('reads only what it needs when the consumer takes a few values', () => {
    const SOURCES = 500
    const PER_SOURCE = 1000
    const TAKE = 10

    const wrapped = Array.from({ length: SOURCES }, (_, s) =>
      counted(Array.from({ length: PER_SOURCE }, (_, i) => s + i * SOURCES)),
    )

    const merged = mergeSorted(wrapped.map((w) => w.source))
    const first = take(merged, TAKE)

    expect(first.length).toBe(TAKE)
    for (let i = 1; i < first.length; i++) {
      expect(first[i]!).toBeGreaterThanOrEqual(first[i - 1]!)
    }

    const totalPulls = wrapped.reduce((sum, w) => sum + w.pulls(), 0)
    assertWithinBudget(totalPulls, SOURCES + TAKE + 10, 'mergeSorted laziness')
  })

  it('terminates on an infinite source', () => {
    // A solution that reads a source to completion does not get a wrong
    // answer here — it never produces one at all. See countUp's guard for how
    // that surfaces.
    const merged = mergeSorted([countUp(0, 2), countUp(1, 2)])
    expect(take(merged, 6)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('stays lazy when one source is infinite and the others are short', () => {
    const finite = counted([100, 200])
    const merged = mergeSorted([countUp(0, 1), finite.source])

    expect(take(merged, 5)).toEqual([0, 1, 2, 3, 4])
    // The finite source should have been touched at most once, to see its head.
    assertWithinBudget(finite.pulls(), 1, 'mergeSorted lookahead on an idle source')
  })
})
