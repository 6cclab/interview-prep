/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: there is no asymptotically-worse-but-correct approach to reject.
 * The obvious solution is the only solution, which is exactly why it is here —
 * see ".claude/CLAUDE.md" > "The warm-up tier" for why that exemption exists.
 */

import { describe, expect, it } from 'vitest'
import { maxDepth, type TreeNode } from './solution'

function leaf(val: number): TreeNode {
  return { val, left: null, right: null }
}

describe('maxDepth — correctness', () => {
  it('measures a small tree', () => {
    const root: TreeNode = {
      val: 3,
      left: leaf(9),
      right: { val: 20, left: leaf(15), right: leaf(7) },
    }
    expect(maxDepth(root)).toBe(3)
  })

  it('handles an empty tree', () => {
    expect(maxDepth(null)).toBe(0)
  })

  it('handles a single node', () => {
    expect(maxDepth(leaf(1))).toBe(1)
  })

  // A one-sided tree is where "the deeper of the two children" is easy to get
  // wrong by averaging, or by only following one side.
  it('follows the deeper side when the tree leans left', () => {
    const root: TreeNode = { val: 1, left: { val: 2, left: leaf(3), right: null }, right: null }
    expect(maxDepth(root)).toBe(3)
  })

  it('follows the deeper side when the tree leans right', () => {
    const root: TreeNode = { val: 1, left: null, right: { val: 2, left: null, right: leaf(3) } }
    expect(maxDepth(root)).toBe(3)
  })

  it('measures a fully unbalanced tree', () => {
    // A 2,000-node chain — deep enough to be a real spine, shallow enough that a
    // recursive answer is not being asked to survive a stack overflow.
    let node = leaf(0)
    for (let i = 1; i < 2000; i++) node = { val: i, left: node, right: null }
    expect(maxDepth(node)).toBe(2000)
  })

  it('measures a balanced tree', () => {
    function full(depth: number): TreeNode | null {
      if (depth === 0) return null
      return { val: depth, left: full(depth - 1), right: full(depth - 1) }
    }
    expect(maxDepth(full(10))).toBe(10)
  })
})
