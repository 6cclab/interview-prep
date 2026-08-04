import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { shortestClearPath } from './solution'

describe('shortestClearPath — correctness', () => {
  it('takes the single diagonal move between two clear corners', () => {
    // Orthogonal neighbors of both corners are blocked, so a 4-directional
    // solution finds no path at all here and would return -1. And the path
    // has exactly one move but visits two cells, so a solution that counts
    // steps instead of cells would return 1, not 2.
    expect(
      shortestClearPath([
        [0, 1],
        [1, 0],
      ]),
    ).toBe(2)
  })

  it('mixes straight and diagonal moves to reach the shortest cell count', () => {
    // (0,0) -> (0,1) -> (1,2) -> (2,2): 4 cells, 3 moves. A 4-directional
    // solution is forced the long way around (5 cells) since (1,1) and
    // (2,1) are blocked, so this also fails a 4-directional solution. A
    // steps-instead-of-cells solution would report 3, not 4.
    expect(
      shortestClearPath([
        [0, 0, 0],
        [1, 1, 0],
        [1, 1, 0],
      ]),
    ).toBe(4)
  })

  it('returns -1 when the start cell is blocked', () => {
    expect(
      shortestClearPath([
        [1, 0],
        [0, 0],
      ]),
    ).toBe(-1)
  })

  it('returns -1 when the end cell is blocked', () => {
    expect(
      shortestClearPath([
        [0, 0],
        [0, 1],
      ]),
    ).toBe(-1)
  })

  it('handles a single clear cell', () => {
    expect(shortestClearPath([[0]])).toBe(1)
  })

  it('handles a single blocked cell', () => {
    expect(shortestClearPath([[1]])).toBe(-1)
  })

  it('returns -1 when the end is genuinely unreachable', () => {
    // Row 1 is a solid wall of 1s. Diagonal moves only ever change row by
    // one, so nothing in row 0 can reach row 2 without passing through row
    // 1 — and row 1 has no clear cell anywhere. The start and end cells
    // are both clear, but there is no route between them at all.
    expect(
      shortestClearPath([
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    ).toBe(-1)
  })
})

describe('shortestClearPath — scale', () => {
  /**
   * A brute force that enumerates all simple paths from corner to corner —
   * whether via unbounded DFS over all routes, or via repeatedly re-relaxing
   * distances instead of stopping at the first frontier that reaches a
   * cell — degenerates badly on an open grid. An open grid is the
   * adversarial case for path enumeration: with (almost) every cell clear,
   * the branching factor at each step is close to 8, and the number of
   * simple paths between two corners grows exponentially with n. A sparse
   * maze with few routes would not stress this at all, so this grid is
   * built almost entirely open.
   *
   * n = 500, with only a handful of cells (not on the fully-open diagonal
   * corridor) flipped to 1 as harmless noise, so the shortest path itself
   * cannot be second-guessed by a lucky degenerate shortcut. Generated
   * deterministically via `mulberry32` (see test-utils/random.ts) so the
   * suite stays reproducible.
   *
   * The expected answer is derived analytically, not computed by another
   * implementation: on a fully open n x n grid, 8-directional movement lets
   * every step move both a row and a column at once, so walking the main
   * diagonal from (0,0) to (n-1,n-1) takes exactly n-1 diagonal moves,
   * i.e. n cells. No path can be shorter, because each move changes
   * `max(|dRow|, |dCol|)` by at most 1, and that quantity starts at n-1 and
   * must reach 0. Kept clear of blocked cells, that bound of n is exactly
   * achieved.
   */
  it('finishes well within budget on a large, mostly-open grid', () => {
    const N = 500
    const SEED = 0xba5eba11
    const rand = mulberry32(SEED)

    const grid: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0))

    // Sprinkle light, deterministic noise, but never touch the main
    // diagonal — that keeps the n-cell diagonal path clear and the
    // analytically-known answer intact regardless of where the noise lands.
    const NOISE_CELLS = Math.floor(N * N * 0.01)
    for (let k = 0; k < NOISE_CELLS; k++) {
      const r = Math.floor(rand() * N)
      const c = Math.floor(rand() * N)
      if (r === c) continue
      if ((r === 0 && c === 0) || (r === N - 1 && c === N - 1)) continue
      grid[r]![c] = 1
    }

    const t0 = performance.now()
    const result = shortestClearPath(grid)
    const elapsed = performance.now() - t0

    expect(result).toBe(N)
    // Vitest's testTimeout does not reliably preempt a synchronous,
    // CPU-bound loop, so elapsed time is measured explicitly here rather
    // than relied on to fail the test on its own.
    expect(elapsed).toBeLessThan(5000)
  })
})
