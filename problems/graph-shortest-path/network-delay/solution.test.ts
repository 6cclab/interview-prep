import { describe, expect, it } from 'vitest'
import { mulberry32, shuffled } from '../../../test-utils/random'
import { networkDelayTime } from './solution'

describe('networkDelayTime — correctness', () => {
  it('finds the canonical delay', () => {
    expect(
      networkDelayTime(
        [
          [2, 1, 1],
          [2, 3, 1],
          [3, 4, 1],
        ],
        4,
        2,
      ),
    ).toBe(2)
  })

  it('handles a single node with no edges', () => {
    expect(networkDelayTime([], 1, 1)).toBe(0)
  })

  it('returns -1 when a node has no route in', () => {
    expect(networkDelayTime([], 2, 1)).toBe(-1)
  })

  it('returns -1 when one node in a larger graph is unreachable', () => {
    // Node 5 has no incoming edge at all — nothing can ever reach it.
    const times = [
      [1, 2, 1],
      [2, 3, 1],
      [3, 4, 1],
      [1, 4, 10],
    ]
    expect(networkDelayTime(times, 5, 1)).toBe(-1)
  })

  it('rejects a solution that only tries direct edges', () => {
    // The direct edge 1 -> 2 costs 10. Routing through 3 costs 1 + 1 = 2.
    // A solution that only looks at direct edges from k, or that never
    // relaxes past the first hop, reports 10 (or the max over both nodes,
    // 10) instead of the true answer.
    const times = [
      [1, 2, 10],
      [1, 3, 1],
      [3, 2, 1],
    ]
    // dist(2) = 2 via node 3, dist(3) = 1 -> answer is max(2, 1) = 2
    expect(networkDelayTime(times, 3, 1)).toBe(2)
  })

  it('takes the cheapest of several parallel edges between the same pair', () => {
    const times = [
      [1, 2, 5],
      [1, 2, 1],
      [1, 2, 3],
    ]
    expect(networkDelayTime(times, 2, 1)).toBe(1)
  })

  it('is not derailed by a self-loop', () => {
    const times = [
      [1, 1, 5],
      [1, 2, 1],
      [2, 3, 1],
    ]
    expect(networkDelayTime(times, 3, 1)).toBe(2)
  })
})

describe('networkDelayTime — scale', () => {
  /**
   * The graph is a chain 1 -> 2 -> ... -> N, each hop weight 1, so the
   * distance from k = 1 to node i is exactly i - 1 by construction, and the
   * network delay (the max over all nodes) is exactly N - 1. That's the
   * known answer this test asserts against.
   *
   * On top of the chain, every node gets D extra directed "noise" edges to
   * random targets, each weighted somewhere in [N, 2N). Since the entire
   * chain is reachable at distance at most N - 1, and a single noise edge
   * already costs at least N > N - 1, no path that uses even one noise edge
   * can ever beat (or tie) a chain-only path to the same node — regardless
   * of how many noise edges it strings together, since all weights are
   * positive. So the noise can never change the answer; it only inflates
   * the edge count.
   *
   * Both the chain and the noise are generated deterministically via
   * `mulberry32` (seeded) so the suite stays reproducible.
   *
   * N * D noise edges plus N chain edges puts total edges around 1.45M and
   * nodes at 8,000. A brute force that re-relaxes every edge once per node
   * (O(V*E)) does roughly 8,000 * 1,450,000 ≈ 1.16*10^10 relaxations —
   * far too slow to finish in 5s. The reference approach finishes in well
   * under a second — two-plus orders of magnitude of margin.
   *
   * Vitest's `testTimeout` does not reliably preempt a synchronous
   * CPU-bound loop, so elapsed time is measured explicitly below instead of
   * relying on the timeout to catch a brute force.
   *
   * The edge list is shuffled (again via the same seeded PRNG) before use.
   * Left in construction order, the chain edges [1,2],[2,3],...,[N-1,N]
   * would sit consecutively and in increasing order — a single left-to-right
   * pass over an edge list in that order propagates the whole chain's
   * distances in one shot, letting even an all-edges-every-round relaxation
   * loop converge in two passes instead of the ~N a genuinely adversarial
   * order forces. Shuffling removes that accidental shortcut without
   * changing the graph itself.
   */
  it('finishes well within budget on a large, dense graph with a known answer', () => {
    const N = 8000
    const D = 180
    const SEED = 0x9e_3779_b9
    const rand = mulberry32(SEED)

    const times: number[][] = []

    for (let i = 1; i < N; i++) {
      times.push([i, i + 1, 1])
    }

    for (let u = 1; u <= N; u++) {
      for (let j = 0; j < D; j++) {
        const v = 1 + Math.floor(rand() * N)
        const w = N + Math.floor(rand() * N)
        times.push([u, v, w])
      }
    }

    const shuffledTimes = shuffled(times, rand)

    const expected = N - 1

    const t0 = performance.now()
    const result = networkDelayTime(shuffledTimes, N, 1)
    const elapsed = performance.now() - t0

    expect(result).toBe(expected)
    expect(elapsed).toBeLessThan(5000)
  })
})
