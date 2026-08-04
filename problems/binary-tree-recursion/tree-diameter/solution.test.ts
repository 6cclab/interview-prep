import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { diameterOfBinaryTree, type TreeNode } from './solution'

/**
 * Build a tree from a level-order array using the common LeetCode-style
 * serialization: `null` marks a missing child, and children are only listed
 * for nodes that exist. `values[0]` is the root; `null` (or an empty array)
 * produces an empty tree.
 */
function buildLevelOrder(values: ReadonlyArray<number | null>): TreeNode | null {
  if (values.length === 0 || values[0] === null) return null

  const root: TreeNode = { val: values[0]!, left: null, right: null }
  const queue: TreeNode[] = [root]
  let i = 1

  while (queue.length > 0 && i < values.length) {
    const node = queue.shift()!

    if (i < values.length) {
      const leftVal = values[i]!
      i++
      if (leftVal !== null) {
        node.left = { val: leftVal, left: null, right: null }
        queue.push(node.left)
      }
    }

    if (i < values.length) {
      const rightVal = values[i]!
      i++
      if (rightVal !== null) {
        node.right = { val: rightVal, left: null, right: null }
        queue.push(node.right)
      }
    }
  }

  return root
}

/** Build a tree of `n` nodes, each one the sole child of the last, all in `direction`. */
function buildChain(n: number, direction: 'left' | 'right'): TreeNode | null {
  let root: TreeNode | null = null
  for (let i = n - 1; i >= 0; i--) {
    const node: TreeNode = { val: i, left: null, right: null }
    if (direction === 'left') node.left = root
    else node.right = root
    root = node
  }
  return root
}

/** Build a perfectly balanced tree of `depth` levels (`2^depth - 1` nodes). */
function buildBalanced(depth: number): TreeNode | null {
  if (depth === 0) return null
  let counter = 1
  function grow(level: number): TreeNode | null {
    if (level > depth) return null
    const node: TreeNode = { val: counter++, left: null, right: null }
    node.left = grow(level + 1)
    node.right = grow(level + 1)
    return node
  }
  return grow(1)
}

describe('diameterOfBinaryTree — correctness', () => {
  it('returns 0 for an empty tree', () => {
    expect(diameterOfBinaryTree(null)).toBe(0)
  })

  it('returns 0 for a single node', () => {
    expect(diameterOfBinaryTree(buildLevelOrder([1]))).toBe(0)
  })

  it('returns 1 for two nodes connected by one edge', () => {
    expect(diameterOfBinaryTree(buildLevelOrder([1, 2]))).toBe(1)
    expect(diameterOfBinaryTree(buildLevelOrder([1, null, 2]))).toBe(1)
  })

  it('handles the canonical example', () => {
    expect(diameterOfBinaryTree(buildLevelOrder([1, 2, 3, 4, 5]))).toBe(3)
  })

  it('handles a perfectly balanced tree', () => {
    // Depth 4 (15 nodes): the longest path runs leaf-to-leaf through the
    // root, crossing 3 edges down each side.
    expect(diameterOfBinaryTree(buildBalanced(4))).toBe(6)
  })

  it('handles a diameter that does not pass through the root', () => {
    // Root has a single child; the longest path lives entirely below it and
    // never touches the root. A solution that only checks
    // height(root.left) + height(root.right) at the top level misses this.
    const root = buildLevelOrder([1, 2, null, 3, 4])
    // root(1) -> 2 -> {3, 4}; extend 3 and 4 one level deeper each.
    root!.left!.left!.left = { val: 5, left: null, right: null }
    root!.left!.right!.right = { val: 6, left: null, right: null }
    expect(diameterOfBinaryTree(root)).toBe(4)
  })

  it('handles a left-skewed chain', () => {
    const n = 500
    expect(diameterOfBinaryTree(buildChain(n, 'left'))).toBe(n - 1)
  })

  it('handles a right-skewed chain', () => {
    const n = 500
    expect(diameterOfBinaryTree(buildChain(n, 'right'))).toBe(n - 1)
  })
})

describe('diameterOfBinaryTree — scale', () => {
  /**
   * A solution that computes height(node) as its own separate top-to-bottom
   * traversal at every node it visits does O(n) work per node, O(n^2)
   * overall. A balanced tree only costs that solution O(n log n) — not
   * enough to discriminate — so this uses a left-skewed chain, the
   * degenerate case where the repeated height computation is at its worst:
   * the height call rooted at the k-th node from the top alone costs
   * O(n - k), and summing that over all n nodes is O(n^2).
   *
   * The chain is built deterministically (no randomness needed — its
   * structure, not its values, is what matters; node values still come from
   * a seeded `mulberry32` stream to avoid a hardcoded pattern). Its
   * diameter is known analytically: a chain of n nodes has n - 1 edges
   * end to end and no branching, so that's its only path and its diameter.
   *
   * The chain length is chosen to sit safely inside the JS engine's
   * recursion limit — a single top-to-bottom traversal of this chain does
   * not overflow the call stack — while still being long enough that the
   * O(n^2) solution's *repeated* traversals take on the order of hundreds
   * of milliseconds, comfortably outside measurement noise.
   */
  it('finishes well within budget on a long skewed chain', () => {
    const N = 6000
    const SEED = 0xdec1de
    const rand = mulberry32(SEED)

    let root: TreeNode | null = null
    for (let i = N - 1; i >= 0; i--) {
      root = { val: Math.floor(rand() * 200) - 100, left: root, right: null }
    }

    const t0 = performance.now()
    const result = diameterOfBinaryTree(root)
    const elapsed = performance.now() - t0

    expect(result).toBe(N - 1)
    expect(elapsed).toBeLessThan(100)
  })
})
