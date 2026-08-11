/**
 * Warm-up tier: **correctness only, by design.**
 *
 * Every other suite in `problems/` rejects a correct-but-brute-force answer,
 * because `.claude/CLAUDE.md` says a drill is only worth doing if it does. This
 * one cannot: every node has to be visited to be swapped, so any correct
 * approach is O(n) and there is no worse-but-correct alternative to reject. See
 * ".claude/CLAUDE.md" > "The warm-up tier".
 *
 * One case is not decoration: a deep single-sided chain. A recursive solution
 * that recurses once per level overflows the stack there, and an interview
 * follow-up asks about exactly that, so it is worth meeting here rather than
 * live.
 */

import { describe, expect, it } from 'vitest'
import { invertTree, type TreeNode } from './solution'

function leaf(val: number): TreeNode {
  return { val, left: null, right: null }
}

function node(val: number, left: TreeNode | null, right: TreeNode | null): TreeNode {
  return { val, left, right }
}

/** Level order with explicit nulls, so shape is compared and not just contents. */
function levels(root: TreeNode | null): Array<number | null> {
  if (!root) return []
  const out: Array<number | null> = []
  const queue: Array<TreeNode | null> = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (!current) {
      out.push(null)
      continue
    }
    out.push(current.val)
    queue.push(current.left, current.right)
  }
  return out
}

describe('invertTree — correctness', () => {
  it('mirrors a full tree', () => {
    const root = node(4, node(2, leaf(1), leaf(3)), node(7, leaf(6), leaf(9)))
    expect(levels(invertTree(root))).toEqual(levels(node(4, node(7, leaf(9), leaf(6)), node(2, leaf(3), leaf(1)))))
  })

  it('mirrors a lopsided tree, moving the child to the other side', () => {
    const root = node(1, null, leaf(2))
    const inverted = invertTree(root)
    expect(inverted?.left?.val).toBe(2)
    expect(inverted?.right).toBeNull()
  })

  it('leaves a single node alone', () => {
    const inverted = invertTree(leaf(1))
    expect(inverted?.val).toBe(1)
    expect(inverted?.left).toBeNull()
    expect(inverted?.right).toBeNull()
  })

  it('returns null for an empty tree', () => {
    expect(invertTree(null)).toBeNull()
  })

  it('mirrors every level, not just the root', () => {
    const root = node(1, node(2, leaf(4), null), node(3, null, leaf(5)))
    const inverted = invertTree(root)
    expect(inverted?.left?.val).toBe(3)
    expect(inverted?.left?.left?.val).toBe(5)
    expect(inverted?.right?.val).toBe(2)
    expect(inverted?.right?.right?.val).toBe(4)
  })

  it('handles repeated and negative values', () => {
    const root = node(-1, node(-1, leaf(0), null), leaf(-1))
    const inverted = invertTree(root)
    expect(inverted?.left?.val).toBe(-1)
    expect(inverted?.right?.val).toBe(-1)
    expect(inverted?.right?.right?.val).toBe(0)
  })

  it('applied twice, returns the original tree', () => {
    const root = node(4, node(2, leaf(1), leaf(3)), node(7, leaf(6), leaf(9)))
    const before = levels(root)
    expect(levels(invertTree(invertTree(root)))).toEqual(before)
  })

  // A recursive solution that recurses per level blows the stack here.
  it('handles a deep single-sided chain without overflowing', () => {
    let root: TreeNode = leaf(0)
    for (let i = 1; i < 50_000; i += 1) {
      root = node(i, root, null)
    }
    const inverted = invertTree(root)
    let depth = 0
    let current = inverted
    while (current) {
      depth += 1
      expect(current.left).toBeNull()
      current = current.right
    }
    expect(depth).toBe(50_000)
  })
})
