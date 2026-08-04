import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { findRedundantConnection } from './solution'

describe('findRedundantConnection — correctness', () => {
  it('finds the redundant edge in a minimal triangle', () => {
    const edges: [number, number][] = [[1, 2], [1, 3], [2, 3]]
    expect(findRedundantConnection(edges)).toEqual([2, 3])
  })

  it('finds the redundant edge when the cycle forms partway through the list', () => {
    const edges: [number, number][] = [[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]]
    expect(findRedundantConnection(edges)).toEqual([1, 4])
  })

  it('picks the last valid edge even when the cycle closes before the end of the list', () => {
    // The cycle among 1, 2, 3 is already closed by the time [1,3] is added —
    // edge [3,4] afterward only extends the tree, it doesn't touch the
    // cycle. A solution that just returns whatever edge happens to be last
    // in the input, without checking anything, would answer [3,4] here and
    // be wrong.
    const edges: [number, number][] = [[1, 2], [2, 3], [1, 3], [3, 4]]
    expect(findRedundantConnection(edges)).toEqual([1, 3])
  })

  it('handles the smallest possible graph in a different edge order', () => {
    const edges: [number, number][] = [[1, 3], [2, 3], [1, 2]]
    expect(findRedundantConnection(edges)).toEqual([1, 2])
  })

  it('handles a longer chain closed into a loop at the end', () => {
    const n = 30
    const edges: [number, number][] = []
    for (let i = 1; i < n; i++) edges.push([i, i + 1])
    edges.push([1, n])
    expect(findRedundantConnection(edges)).toEqual([1, n])
  })
})

describe('findRedundantConnection — scale', () => {
  /**
   * The correctness tests above are all small enough that a solution doing
   * a lot of repeated work per edge would still return in a blink. That
   * says nothing about how the solution behaves as the graph grows, so this
   * test builds a much larger graph and puts a hard wall-clock budget on
   * top of the answer.
   *
   * Vitest's own test timeout is a safety net, not a precise budget check —
   * it won't necessarily interrupt a long synchronous computation partway
   * through, so the elapsed time is measured directly with
   * `performance.now()` and asserted against explicitly below.
   *
   * The graph is a single long chain over N nodes (node i connected to
   * i + 1) with one extra edge added at the very end to close it into a
   * loop. That extra edge is the only correct answer, and it's known here
   * by construction — not by searching the graph — so the assertion below
   * doesn't depend on the solution under test to determine what "correct"
   * means. The chain edges are shuffled with a seeded, deterministic
   * generator (never `Math.random()`) so their order in the input carries
   * no special structure, while the closing edge is appended last, which is
   * what fixes it as the unambiguous answer under the tie-break rule.
   */
  it('finishes well within budget on a large, chain-shaped graph', () => {
    const N = 25_000
    const SEED = 0xfeed_5eed
    const rng = mulberry32(SEED)

    const treeEdges: [number, number][] = []
    for (let i = 1; i < N; i++) treeEdges.push([i, i + 1])
    const closingEdge: [number, number] = [1, N]
    const edges = [...shuffled(treeEdges, rng), closingEdge]

    const BUDGET_MS = 250

    const start = performance.now()
    const result = findRedundantConnection(edges)
    const elapsed = performance.now() - start

    expect(result).toEqual(closingEdge)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })
})
