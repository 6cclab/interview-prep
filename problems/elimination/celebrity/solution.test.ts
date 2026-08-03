import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'
import { findCelebrity } from './solution'

/**
 * Build a knows-matrix for a party of `n` where `celebrity` (or nobody, when
 * null) satisfies both celebrity properties. Non-celebrities know the
 * celebrity and a scattering of each other; everybody knows themselves.
 *
 * The no-celebrity case uses a total order (a knows b whenever a < b) plus
 * one wraparound edge (n-1 knows 0). This is deliberate: a naive
 * candidate-by-candidate scan that bails out on the first disqualifying
 * pair can't reject candidate c cheaply, because everyone below c "knows"
 * everyone above c — the scan only discovers the disqualifying pair once it
 * reaches other = c + 1. A sparser matrix lets that scan reject every
 * candidate in ~2 calls and stay under budget by accident.
 */
function party(n: number, celebrity: number | null): boolean[][] {
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
    const other: number = (a + 1) % n
    if (other !== celebrity && other !== a) m[a]![other] = true
  }
  return m
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
})
