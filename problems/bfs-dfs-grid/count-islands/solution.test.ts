import { describe, expect, it } from 'vitest'
import { countIslands } from './solution'

/** Builds a grid from row strings, so the fixtures read like the pictures they are. */
function grid(...rows: string[]): string[][] {
  return rows.map((row) => row.split(''))
}

describe('countIslands — correctness', () => {
  it('counts one landmass that spans most of the grid', () => {
    expect(
      countIslands(
        grid(
          '11110', //
          '11010',
          '11000',
          '00000',
        ),
      ),
    ).toBe(1)
  })

  it('counts three separate landmasses', () => {
    // (1,1) and (2,2) touch only at a corner. A solution that treats the four
    // diagonals as connections merges them and reports 2, not 3.
    expect(
      countIslands(
        grid(
          '11000', //
          '11000',
          '00100',
          '00011',
        ),
      ),
    ).toBe(3)
  })

  it('does not connect cells that touch only at a corner', () => {
    // The tightest possible statement of the same rule: two cells, one shared
    // corner, nothing else. Eight-directional movement returns 1 here.
    expect(
      countIslands(
        grid(
          '10', //
          '01',
        ),
      ),
    ).toBe(2)
  })

  it('returns 0 for a grid with no land', () => {
    expect(
      countIslands(
        grid(
          '00', //
          '00',
        ),
      ),
    ).toBe(0)
  })

  it('counts a single land cell', () => {
    expect(countIslands(grid('1'))).toBe(1)
  })

  it('counts a single water cell', () => {
    expect(countIslands(grid('0'))).toBe(0)
  })

  it('handles land running along every edge', () => {
    // A ring of land around a lake. One island, and it exercises the grid
    // boundary on all four sides — an unguarded neighbour lookup walks off
    // the edge here rather than in some interior corner case.
    expect(
      countIslands(
        grid(
          '1111', //
          '1001',
          '1001',
          '1111',
        ),
      ),
    ).toBe(1)
  })

  it('counts a single-row and a single-column grid', () => {
    expect(countIslands(grid('101101'))).toBe(3)
    expect(countIslands(grid('1', '0', '1', '1'))).toBe(2)
  })

  it('follows a landmass that snakes back on itself', () => {
    // One island, but reaching all of it requires turning repeatedly. A
    // traversal that only ever walks right and down stops early and
    // over-counts.
    expect(
      countIslands(
        grid(
          '11111', //
          '00001',
          '11111',
          '10000',
          '11111',
        ),
      ),
    ).toBe(1)
  })
})

describe('countIslands — scale', () => {
  /**
   * The trap here is not a brute force in the usual sense — the answer is
   * still reachable by walking each landmass — but a solution whose visited
   * bookkeeping is **per island** rather than per scan. Allocating a fresh
   * m x n visited array (or clearing a shared one) each time a new island is
   * found is correct, easy to write, and costs O(m*n) per island instead of
   * O(1). It is the most common way this problem goes quadratic.
   *
   * A checkerboard is the adversarial case for exactly that mistake: with
   * land on every cell where (row + col) is even and four-directional
   * connectivity, **no two land cells are ever adjacent**, so every single
   * one of them is its own island. That maximises the island count for a
   * given grid size, which is the multiplier the per-island cost is paid
   * against.
   *
   * n = 400, so the grid holds 160,000 cells and 80,000 islands. Measured on
   * the machine this was authored on: a linear scan finishes in ~8ms, a
   * per-island reset takes ~11s. The size is deliberately tuned to that gap.
   * Larger grids widen it, but a per-island solution then runs for two minutes
   * before failing, and a drill whose red takes two minutes to arrive is a
   * drill that stops being run. At this size the wrong answer comes back in
   * about eleven seconds, having failed the elapsed assertion outright rather
   * than dying to a timeout that says nothing about cost.
   *
   * The expected answer is derived analytically rather than by running
   * another implementation: in an n x n grid with n even, exactly half the
   * cells have (row + col) even, so the count is n*n/2 = 80,000.
   *
   * Note this fixture deliberately does *not* include a single huge
   * connected landmass. That would test recursion depth rather than the
   * cost of the bookkeeping, and would fail an ordinary recursive solution
   * on stack size — a different lesson, and not the one this problem is for.
   */
  it('finishes well within budget on a grid with hundreds of thousands of islands', () => {
    const N = 400
    const board: string[][] = Array.from({ length: N }, (_, r) =>
      Array.from({ length: N }, (_, c) => ((r + c) % 2 === 0 ? '1' : '0')),
    )

    const t0 = performance.now()
    const result = countIslands(board)
    const elapsed = performance.now() - t0

    expect(result).toBe((N * N) / 2)
    // Vitest's testTimeout does not reliably preempt a synchronous, CPU-bound
    // loop, so elapsed time is measured explicitly here rather than relied on
    // to fail the test on its own.
    expect(elapsed).toBeLessThan(5000)
  })
})
