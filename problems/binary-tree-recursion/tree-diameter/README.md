# Tree Diameter

You are given the root of a binary tree. Return the length of the longest
path between any two nodes in the tree.

The path does not need to pass through the root, and it doesn't need to go
through any particular node — it's the longest path between *any* two nodes,
measured however it winds through the tree.

**The length is counted in edges, not nodes.** A path connecting two nodes
that are directly linked (a parent and its child) has length `1` — one edge
— even though it visits `2` nodes. A path visiting `k` nodes always has
length `k - 1`.

## Constraints

- The number of nodes is in `[0, 10^4]`.
- `-100 <= Node.val <= 100`
- A solution that, for every node it visits, separately re-measures how far
  down each of its subtrees extends will be rejected by this problem's test
  suite, even when it returns the correct answer.

## Examples

```
    1
   / \
  2   3
 / \
4   5

-> 3
```

The longest path is `4 - 2 - 1 - 3` (or `5 - 2 - 1 - 3`): 3 edges connecting
4 nodes. It passes through the root here, but that's incidental to this
particular tree's shape — see the next example.

```
        1
       /
      2
     / \
    3   4
   /     \
  5       6

-> 4
```

The longest path is `5 - 3 - 2 - 4 - 6`: 4 edges connecting 5 nodes. It runs
entirely through node `2` and never touches the root (`1`) at all — the
root only has one child, so any path through it would have to dead-end
there. Don't assume the answer involves the root; it usually won't.

```
root = null
-> 0

root = single node (no children)
-> 0
```

A single node has no pair of distinct nodes to connect, so its diameter is
`0` — not `1`.

## Node type and signature

```ts
export interface TreeNode {
  val: number
  left: TreeNode | null
  right: TreeNode | null
}

export function diameterOfBinaryTree(root: TreeNode | null): number
```

## Run it

```bash
pnpm test tree-diameter     # attempt
pnpm reset tree-diameter    # start over from a clean stub
```
