# Maximum Depth of a Binary Tree — worked solution

> **Spoilers.** Do not read this during an attempt.

> Warm-up tier: correctness only. There is no cost trap here.

## The observation

The depth of a tree is one more than the depth of its deeper subtree, and the
depth of an empty tree is zero. That is the entire definition, and it is already
the algorithm.

## Reference solution

```ts
export function maxDepth(root: TreeNode | null): number {
  if (root === null) return 0
  return 1 + Math.max(maxDepth(root.left), maxDepth(root.right))
}
```

`Math.max` and not addition or averaging: depth is the longest path, not the total
or the typical one.

## Cost

Time O(n) — every node is visited once. Space O(h) for the call stack, where h is
the height. On a balanced tree that is O(log n); on a degenerate chain it is O(n),
which is the honest caveat and the reason the iterative level-by-level version
exists. At the stated 10,000 nodes recursion is safe; say where it stops being
safe.

## The tell

Nothing to spot — this is the recursion warm-up. What matters is stating the base
case first and trusting the recursive call to be correct for the subtree, rather
than trying to trace the whole traversal in your head. That habit is what the
harder tree problems in this repo are built on: the same shape, with something
extra carried up through the return value.
