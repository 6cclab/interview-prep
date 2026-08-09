# Maximum Depth of a Binary Tree

Given the root of a binary tree, return its maximum depth — the number of nodes
along the longest path from the root down to a leaf.

An empty tree has depth 0.

## Constraints

- `0 <= node count <= 10000`
- The tree may be badly unbalanced
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
    3
   / \
  9  20
     / \
    15  7
-> 3

single node  -> 1
empty tree   -> 0
```

## Signature

```ts
export function maxDepth(root: TreeNode | null): number
```

## Run it

```bash
pnpm test max-depth     # attempt
pnpm reset max-depth    # start over from a clean stub
```
