import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'
import { findCelebrity } from './solution'

/**
 * Build a knows-matrix for a party of `n` where `celebrity` (or nobody, when
 * null) satisfies both celebrity properties. Both branches build a dense
 * total order rather than a sparse one: `a knows b` whenever `a < b`
 * (celebrity aside), so every candidate has many disqualifying witnesses
 * rather than one or two.
 *
 * Density alone does not close the budget against every brute force,
 * though. It only makes a fixed probe order expensive when that order
 * runs against the grain of the total order (e.g. an inner scan from 0
 * upward has to walk through most of a candidate's row before hitting a
 * witness). A probe order that runs the other way — starting from the
 * high end, or wrapping around — finds a disqualifying witness in one or
 * two calls on this same matrix, because the witnesses for "a knows b"
 * all sit on the low side of a. Reversing the order's direction (see
 * `reverseOrientation` below) relabels which indices are "high" and which
 * are "low", which flips which probe orders are cheap and which are
 * expensive. So no single fixed probe order can be cheap on both a
 * matrix and its reverse — that is what actually rejects every O(n^2)
 * brute force, and it's why the budget tests below assert on both
 * orientations. A sparse matrix would let a lucky probe order reject
 * every candidate in 1-2 calls regardless of orientation and sneak under
 * the budget by accident, which would defeat the whole point of the
 * drill: rejecting a correct-but-brute-force solution, not just a wrong
 * one.
 *
 * The no-celebrity case uses a total order (a knows b whenever a < b) plus
 * one wraparound edge (n-1 knows 0). The celebrity case uses the same
 * total-order backbone among the non-celebrities, plus every non-celebrity
 * knowing the celebrity.
 */
function party(n: number, celebrity: number | null): boolean[][] {
  if (celebrity === null && n === 1) {
    throw new Error('party(1, null) is impossible: a lone person is vacuously a celebrity')
  }

  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
  for (let a = 0; a < n; a++) m[a]![a] = true

  if (celebrity === null) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) m[a]![b] = true
    }
    if (n > 1) m[n - 1]![0] = true
    return m
  }

  for (let a = 0; a < n; a++) {
    if (a === celebrity) continue
    m[a]![celebrity] = true
    for (let b: number = a + 1; b < n; b++) if (b !== celebrity) m[a]![b] = true // : number is load-bearing — plain `let b` here trips TS7022; do not "tidy" to match line 33
  }
  return m
}

/** Relabel a party so index i becomes n-1-i, reversing the total order's direction. */
function reverseOrientation(m: boolean[][]): boolean[][] {
  const n = m.length
  return Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) => m[n - 1 - a]![n - 1 - b]!),
  )
}

function oracleFor(m: boolean[][]) {
  return countCalls((a: number, b: number) => m[a]![b]!)
}

describe('findCelebrity — correctness', () => {
  it('finds the celebrity in a party of two', () => {
    const knows = oracleFor(party(2, 1))
    expect(findCelebrity(2, knows.fn)).toBe(1)
  })

  it('returns 0 for a party of one', () => {
    const knows = oracleFor(party(1, 0))
    expect(findCelebrity(1, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the first index', () => {
    const knows = oracleFor(party(6, 0))
    expect(findCelebrity(6, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the last index', () => {
    const knows = oracleFor(party(6, 5))
    expect(findCelebrity(6, knows.fn)).toBe(5)
  })

  it('finds a celebrity in the middle', () => {
    const knows = oracleFor(party(9, 4))
    expect(findCelebrity(9, knows.fn)).toBe(4)
  })

  it('returns -1 when nobody is known by everyone', () => {
    const knows = oracleFor(party(5, null))
    expect(findCelebrity(5, knows.fn)).toBe(-1)
  })

  it('returns -1 when the candidate knows somebody', () => {
    const m = party(4, 2)
    m[2]![3] = true // person 2 is known by all, but knows 3 — not a celebrity
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })

  it('returns -1 when one person fails to know the candidate', () => {
    const m = party(4, 2)
    m[3]![2] = false // person 3 does not know 2
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })
})

describe('findCelebrity — budget', () => {
  // The canonical two-pass solution costs 3n - 3 knows() calls (n - 1 to
  // find a candidate, up to 2(n - 1) to verify it), so the 3n bound below
  // is tight by design — it leaves just enough slack for the reference
  // algorithm while still rejecting an O(n^2) brute force.
  it('stays within 3n knows() calls on a large party', () => {
    const n = 500
    const knows = oracleFor(party(n, 317))
    expect(findCelebrity(n, knows.fn)).toBe(317)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })

  it('stays within 3n knows() calls when there is no celebrity', () => {
    const n = 500
    const knows = oracleFor(party(n, null))
    expect(findCelebrity(n, knows.fn)).toBe(-1)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })

  // No single fixed probe order is cheap on both a total order and its
  // reverse (see the comment on `party` above), so these two fixtures
  // close off the brute forces that slip under the budget on the forward
  // orientation alone.
  it('stays within 3n knows() calls on a reverse-orientation party', () => {
    const n = 500
    const knows = oracleFor(reverseOrientation(party(n, 317)))
    expect(findCelebrity(n, knows.fn)).toBe(n - 1 - 317)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })

  it('stays within 3n knows() calls on a reverse-orientation party with no celebrity', () => {
    const n = 500
    const knows = oracleFor(reverseOrientation(party(n, null)))
    expect(findCelebrity(n, knows.fn)).toBe(-1)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })
})
