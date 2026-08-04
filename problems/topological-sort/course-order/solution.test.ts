import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { findOrder } from './solution'

/**
 * True iff `order` is a permutation of `0..numCourses-1` in which every
 * prerequisite pair is respected: for each `[a, b]` in `prerequisites`, `b`
 * appears before `a`.
 *
 * Any order satisfying this is an acceptable answer — there is no single
 * correct output to assert against.
 */
function isValidOrder(
  numCourses: number,
  prerequisites: number[][],
  order: number[],
): boolean {
  if (order.length !== numCourses) return false

  const position = new Map<number, number>()
  for (let i = 0; i < order.length; i++) {
    const course = order[i]!
    if (position.has(course)) return false // duplicate entry
    position.set(course, i)
  }
  for (let course = 0; course < numCourses; course++) {
    if (!position.has(course)) return false // missing a course
  }

  for (const pair of prerequisites) {
    const a = pair[0]!
    const b = pair[1]!
    const posA = position.get(a)!
    const posB = position.get(b)!
    if (posB > posA) return false
  }

  return true
}

describe('findOrder — correctness', () => {
  it('orders a single dependency', () => {
    const order = findOrder(2, [[1, 0]])
    expect(isValidOrder(2, [[1, 0]], order)).toBe(true)
  })

  it('orders a diamond of dependencies', () => {
    const numCourses = 4
    const prerequisites = [
      [1, 0],
      [2, 0],
      [3, 1],
      [3, 2],
    ]
    const order = findOrder(numCourses, prerequisites)
    expect(isValidOrder(numCourses, prerequisites, order)).toBe(true)
  })

  it('accepts any permutation when there are no prerequisites', () => {
    const numCourses = 5
    const order = findOrder(numCourses, [])
    expect(isValidOrder(numCourses, [], order)).toBe(true)
  })

  it('rejects a direct two-course cycle', () => {
    expect(
      findOrder(2, [
        [1, 0],
        [0, 1],
      ]),
    ).toEqual([])
  })

  it('rejects a longer cycle', () => {
    expect(
      findOrder(4, [
        [1, 0],
        [2, 1],
        [3, 2],
        [0, 3],
      ]),
    ).toEqual([])
  })

  it('rejects when one component cycles even if another component is fine', () => {
    // 0 -> 1 is a clean chain; 2, 3, 4 form a cycle among themselves.
    expect(
      findOrder(5, [
        [1, 0],
        [3, 2],
        [4, 3],
        [2, 4],
      ]),
    ).toEqual([])
  })

  it('rejects a course that requires itself', () => {
    expect(findOrder(1, [[0, 0]])).toEqual([])
  })

  it('tolerates duplicate prerequisite pairs', () => {
    const numCourses = 3
    const prerequisites = [
      [1, 0],
      [1, 0],
      [2, 1],
    ]
    const order = findOrder(numCourses, prerequisites)
    expect(isValidOrder(numCourses, prerequisites, order)).toBe(true)
  })

  it('handles a graph with several disconnected components', () => {
    // 0->1, 2->3->4, and 5 with no edges at all.
    const numCourses = 6
    const prerequisites = [
      [1, 0],
      [3, 2],
      [4, 3],
    ]
    const order = findOrder(numCourses, prerequisites)
    expect(isValidOrder(numCourses, prerequisites, order)).toBe(true)
  })
})

describe('findOrder — scale', () => {
  /**
   * A solution that repeatedly rescans every remaining course looking for
   * one whose prerequisites are already satisfied frees exactly one course
   * per full scan on a long dependency chain — the worst possible shape for
   * that approach. With N courses chained 0 <- 1 <- 2 <- ... <- (N-1), that's
   * roughly N + (N-1) + ... + 1 course-checks, i.e. O(N^2). A solution that
   * processes each edge a bounded number of times finishes in O(N) instead.
   *
   * At N = 20,000 the rescan approach does on the order of 2*10^8
   * course-checks — orders of magnitude too slow to finish inside the
   * budget asserted below, while a linear approach finishes in well under a
   * second. Vitest's `testTimeout` does not reliably preempt a synchronous
   * CPU-bound loop, so elapsed time is measured explicitly instead of
   * relying on the runner to cut it off.
   *
   * The prerequisite list is generated deterministically and then shuffled
   * so a rescan implementation can't get lucky by exploiting input order.
   */
  it('finishes well within budget on a long dependency chain', () => {
    const N = 100_000
    const SEED = 0xdeadbeef

    const prerequisites: number[][] = []
    for (let i = 1; i < N; i++) prerequisites.push([i, i - 1])

    const rng = mulberry32(SEED)
    const shuffledPrereqs = shuffled(prerequisites, rng)

    const t0 = performance.now()
    const order = findOrder(N, shuffledPrereqs)
    const elapsed = performance.now() - t0

    expect(elapsed).toBeLessThan(5000)
    expect(isValidOrder(N, shuffledPrereqs, order)).toBe(true)
  })
})
