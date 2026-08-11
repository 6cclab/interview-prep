/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: merging two sorted lists is linear in their combined length
 * however you write it, so there is no asymptotically-worse-but-correct approach
 * to reject. What it tests is the pointer bookkeeping — see
 * ".claude/CLAUDE.md" > "The warm-up tier".
 */

import { describe, expect, it } from 'vitest'
import { firstDifference } from '../../../test-utils/sequence'
import { mergeTwoSorted, type ListNode } from './solution'

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
  // Bounded so a solution that accidentally builds a cycle fails an assertion
  // instead of hanging the suite.
  let guard = 0
  while (node && guard < 500_000) {
    out.push(node.val)
    node = node.next
    guard += 1
  }
  return out
}

describe('mergeTwoSorted — correctness', () => {
  it('interleaves two lists of the same length', () => {
    const merged = mergeTwoSorted(build([1, 2, 4]), build([1, 3, 4]))
    expect(toArray(merged)).toEqual([1, 1, 2, 3, 4, 4])
  })

  it('handles one empty list', () => {
    expect(toArray(mergeTwoSorted(null, build([0])))).toEqual([0])
    expect(toArray(mergeTwoSorted(build([0]), null))).toEqual([0])
  })

  it('handles two empty lists', () => {
    expect(mergeTwoSorted(null, null)).toBeNull()
  })

  it('appends a wholly larger list after a wholly smaller one', () => {
    expect(toArray(mergeTwoSorted(build([1, 2, 3]), build([4, 5, 6])))).toEqual([1, 2, 3, 4, 5, 6])
    expect(toArray(mergeTwoSorted(build([4, 5, 6]), build([1, 2, 3])))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('handles lists of very different lengths', () => {
    expect(toArray(mergeTwoSorted(build([2]), build([1, 3, 4, 5, 6])))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('handles duplicates within and across the lists', () => {
    expect(toArray(mergeTwoSorted(build([1, 1, 1]), build([1, 1])))).toEqual([1, 1, 1, 1, 1])
  })

  it('handles negative values', () => {
    expect(toArray(mergeTwoSorted(build([-5, -1, 0]), build([-3, 2])))).toEqual([-5, -3, -1, 0, 2])
  })

  it('reuses the input nodes rather than allocating new ones', () => {
    const a = build([1, 3])!
    const b = build([2])!
    const firstOfA = a
    const firstOfB = b
    const merged = mergeTwoSorted(a, b)
    const nodes = new Set<ListNode>()
    let node = merged
    while (node) {
      nodes.add(node)
      node = node.next
    }
    expect(nodes.has(firstOfA)).toBe(true)
    expect(nodes.has(firstOfB)).toBe(true)
  })

  it('merges two long lists', () => {
    const evens = Array.from({ length: 25_000 }, (_, i) => i * 2)
    const odds = Array.from({ length: 25_000 }, (_, i) => i * 2 + 1)
    const merged = toArray(mergeTwoSorted(build(evens), build(odds)))
    // `firstDifference` rather than `toEqual`: a 50k mismatch printed in full
    // hides every other failure in this file. See `test-utils/sequence.ts`.
    expect(firstDifference(merged, [...evens, ...odds].sort((x, y) => x - y))).toBeNull()
  })
})
