import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { detectCycleStart, type ListNode } from './solution'

/**
 * Build a singly linked list from `values`. When `pos` is given, the last
 * node's `next` is pointed back at the node originally at index `pos`,
 * closing a cycle. Returns the head plus the array of created nodes (in
 * original order) so a test can assert cycle-start by identity rather than
 * by value.
 */
function buildList(
  values: number[],
  pos: number | null = null,
): { head: ListNode | null; nodes: ListNode[] } {
  const nodes: ListNode[] = values.map((val) => ({ val, next: null }))
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i]!.next = nodes[i + 1]!
  }
  if (pos !== null && nodes.length > 0) {
    nodes[nodes.length - 1]!.next = nodes[pos]!
  }
  return { head: nodes[0] ?? null, nodes }
}

describe('detectCycleStart — correctness', () => {
  it('returns null for an empty list', () => {
    expect(detectCycleStart(null)).toBeNull()
  })

  it('returns null for a single node with no cycle', () => {
    const { head } = buildList([1])
    expect(detectCycleStart(head)).toBeNull()
  })

  it('returns null for a list with no cycle', () => {
    const { head } = buildList([1, 2, 3, 4, 5])
    expect(detectCycleStart(head)).toBeNull()
  })

  it('returns the node itself when a single node points at itself', () => {
    const { head, nodes } = buildList([7], 0)
    expect(detectCycleStart(head)).toBe(nodes[0])
  })

  it('finds the cycle start in a two-node cycle back to the head', () => {
    const { head, nodes } = buildList([1, 2], 0)
    expect(detectCycleStart(head)).toBe(nodes[0])
  })

  it('finds the cycle start at the head of a longer list', () => {
    const { head, nodes } = buildList([1, 2, 3, 4, 5, 6], 0)
    expect(detectCycleStart(head)).toBe(nodes[0])
  })

  it('finds the cycle start at the last node (a self-loop at the tail)', () => {
    const { head, nodes } = buildList([1, 2, 3, 4, 5], 4)
    expect(detectCycleStart(head)).toBe(nodes[4])
  })

  it('finds the cycle start after a long tail into a short cycle', () => {
    const values = Array.from({ length: 20 }, (_, i) => i)
    const { head, nodes } = buildList(values, 17) // 17 nodes of tail, 3-node cycle
    expect(detectCycleStart(head)).toBe(nodes[17])
  })

  it('finds the cycle start by identity when values repeat throughout the list', () => {
    const { head, nodes } = buildList([9, 9, 9, 9, 9, 9], 2)
    const result = detectCycleStart(head)
    expect(result).toBe(nodes[2])
    // Every node holds the same value, so this only passes if the
    // implementation is comparing node references, not `val`.
    expect(result).not.toBe(nodes[0])
    expect(result).not.toBe(nodes[5])
  })

  it('does not mutate the list', () => {
    const { head, nodes } = buildList([1, 2, 3, 4, 5])
    const nextBefore = nodes.map((n) => n.next)
    const valBefore = nodes.map((n) => n.val)

    detectCycleStart(head)

    for (let i = 0; i < nodes.length; i++) {
      expect(nodes[i]!.next).toBe(nextBefore[i])
      expect(nodes[i]!.val).toBe(valBefore[i])
    }
  })
})

describe('detectCycleStart — scale', () => {
  /**
   * A brute force that, for each node, re-walks the list from the head to
   * check whether that node was already visited does O(1) + O(2) + ... +
   * O(N) work before it can find the first repeat — O(N^2) node
   * comparisons. At N = 200,000 that's ~2 * 10^10 comparisons: far too slow
   * to clear the budget below, while a single-pass approach finishes in
   * single-digit milliseconds. That gap is what this test is for.
   *
   * The list is built with a known answer baked in: N distinct nodes
   * chained together, with the last node's `next` pointed back at the node
   * deep in the list (90% of the way through), closing the cycle. Node
   * values are irrelevant to the answer — they're filled with deterministic
   * noise via `mulberry32` only so the fixture isn't suspiciously uniform —
   * the expected cycle-start node is known by construction regardless of
   * what the values are, because it's the very node the last node's `next`
   * was pointed at when the list was built.
   *
   * A brute force must, by the pigeonhole principle, walk every one of the
   * N distinct nodes at least once before it can encounter a repeat, so
   * placing the entry deep doesn't shrink the outer loop — it's still
   * O(N) outer iterations with O(N) inner work each. What placing it deep
   * does is remove any temptation to special-case "the cycle starts near
   * the head" and rule out a shortcut that only happens to work on a
   * shallow fixture.
   */
  it('finishes well within budget on a large list with a deep cycle entry', () => {
    const N = 200_000
    const SEED = 0xfeedface
    const rand = mulberry32(SEED)

    const entryIndex = Math.floor(N * 0.9)
    const values = new Array<number>(N)
    for (let i = 0; i < N; i++) values[i] = Math.floor(rand() * 10)

    const { head, nodes } = buildList(values, entryIndex)
    const expectedStart = nodes[entryIndex]!

    const t0 = performance.now()
    const result = detectCycleStart(head)
    const elapsed = performance.now() - t0

    expect(result).toBe(expectedStart)
    expect(elapsed).toBeLessThan(5000)
  })
})
