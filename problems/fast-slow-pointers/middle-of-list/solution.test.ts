/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot, and the reason is worth knowing: counting the length in one pass
 * and then walking half of it is *also* linear. Both approaches are O(n) — the
 * single-pass version saves a constant factor, not an order of growth, so there
 * is nothing here a cost assertion could legitimately reject. See
 * ".claude/CLAUDE.md" > "The warm-up tier".
 *
 * The even-length case is the one that actually catches errors, so it is
 * covered at several lengths.
 */

import { describe, expect, it } from 'vitest'
import { middleNode, type ListNode } from './solution'

function build(values: number[]): ListNode | null {
  let head: ListNode | null = null
  for (let i = values.length - 1; i >= 0; i -= 1) {
    head = { val: values[i]!, next: head }
  }
  return head
}

function toArray(head: ListNode | null): number[] {
  const out: number[] = []
  let node = head
  while (node) {
    out.push(node.val)
    node = node.next
  }
  return out
}

describe('middleNode — correctness', () => {
  it('returns the middle of an odd-length list', () => {
    expect(middleNode(build([1, 2, 3, 4, 5]))?.val).toBe(3)
  })

  it('returns the second middle of an even-length list', () => {
    expect(middleNode(build([1, 2, 3, 4]))?.val).toBe(3)
    expect(middleNode(build([1, 2]))?.val).toBe(2)
    expect(middleNode(build([1, 2, 3, 4, 5, 6]))?.val).toBe(4)
  })

  it('returns the only node of a single-element list', () => {
    expect(middleNode(build([1]))?.val).toBe(1)
  })

  it('returns null for an empty list', () => {
    expect(middleNode(null)).toBeNull()
  })

  // The return value is a node in the original list, so the rest of the list
  // must still hang off it.
  it('returns the node itself, with its tail intact', () => {
    const middle = middleNode(build([1, 2, 3, 4, 5]))
    expect(toArray(middle)).toEqual([3, 4, 5])
  })

  it('does not modify the input list', () => {
    const head = build([1, 2, 3, 4, 5])
    middleNode(head)
    expect(toArray(head)).toEqual([1, 2, 3, 4, 5])
  })

  it('agrees with the definition at every length up to 40', () => {
    for (let n = 1; n <= 40; n += 1) {
      const values = Array.from({ length: n }, (_, i) => i)
      const expected = values[Math.floor(n / 2)]
      expect(middleNode(build(values))?.val).toBe(expected)
    }
  })

  it('handles a long list', () => {
    const values = Array.from({ length: 100_000 }, (_, i) => i)
    expect(middleNode(build(values))?.val).toBe(50_000)
  })
})
