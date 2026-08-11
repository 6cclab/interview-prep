/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `AGENTS.md` says a drill is only worth doing if it does. This
 * one cannot: there is no asymptotically-worse-but-correct approach to reject.
 * The obvious solution is the only solution, which is exactly why it is here —
 * see "AGENTS.md" > "The warm-up tier" for why that exemption exists.
 */

import { describe, expect, it } from 'vitest'
import { reverseList, type ListNode } from './solution'

/** Builds a list from values and returns its head. */
function build(values: number[]): ListNode | null {
  let head: ListNode | null = null
  for (let i = values.length - 1; i >= 0; i--) head = { val: values[i]!, next: head }
  return head
}

/** Walks a list into an array. Throws rather than hangs if the list cycles. */
function collect(head: ListNode | null, limit = 10_000): number[] {
  const out: number[] = []
  let node = head
  while (node) {
    if (out.length > limit) throw new Error('list does not terminate')
    out.push(node.val)
    node = node.next
  }
  return out
}

describe('reverseList — correctness', () => {
  it('reverses a list', () => {
    expect(collect(reverseList(build([1, 2, 3])))).toEqual([3, 2, 1])
  })

  it('handles an empty list', () => {
    expect(reverseList(null)).toBeNull()
  })

  it('handles a single node', () => {
    expect(collect(reverseList(build([7])))).toEqual([7])
  })

  it('handles two nodes', () => {
    expect(collect(reverseList(build([1, 2])))).toEqual([2, 1])
  })

  // The classic failure is leaving the original head pointing at its old next,
  // which closes a two-node cycle. `collect` throws rather than hanging.
  it('leaves the new tail terminated rather than cycling', () => {
    const head = build([1, 2, 3, 4])
    const reversed = reverseList(head)
    expect(collect(reversed)).toEqual([4, 3, 2, 1])
    // The original head is now the tail, so its next must be null.
    expect(head!.next).toBeNull()
  })

  it('preserves duplicate values', () => {
    expect(collect(reverseList(build([1, 1, 2, 1])))).toEqual([1, 2, 1, 1])
  })

  it('reverses a longer list', () => {
    const values = Array.from({ length: 5000 }, (_, i) => i)
    expect(collect(reverseList(build(values)))).toEqual(values.slice().reverse())
  })
})
