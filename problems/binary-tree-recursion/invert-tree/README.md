# Invert a Binary Tree

Given the root of a binary tree, swap every node's left and right children so
the whole tree is mirrored, then return the root.

Modifying the tree in place is fine; the caller reads the tree you return.

## Constraints

- `0 <= number of nodes <= 100000`
- Values may repeat and may be negative
- Return `null` for an empty tree
- The tree is not necessarily balanced — a long single-sided chain is a valid
  input
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
      4                     4
    /   \                 /   \
   2     7      ->       7     2
  / \   / \             / \   / \
 1   3 6   9           9   6 3   1

   1              1
    \       ->   /
     2          2

(empty)  ->  (empty)
```

## Signature

```ts
export interface TreeNode {
  val: number
  left: TreeNode | null
  right: TreeNode | null
}

export function invertTree(root: TreeNode | null): TreeNode | null
```

## Run it

```bash
pnpm test invert-tree     # attempt
pnpm reset invert-tree    # start over from a clean stub
```
