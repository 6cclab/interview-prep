# Invert a Binary Tree — worked solution

## The tell

The same local operation applied at every node, with no information needing to
travel between siblings or back up from children. When the answer at a node
depends on nothing but that node and the results below it, recursion writes
itself.

## The observation

At each node: swap its two children, then do the same to both subtrees. Order
does not matter — swapping before or after recursing both produce the mirrored
tree — which is a small sign that the recursion is genuinely independent per
node.

## Reference solution

```ts
export function invertTree(root: TreeNode | null): TreeNode | null {
  if (!root) return null
  const left = root.left
  root.left = root.right
  root.right = left
  invertTree(root.left)
  invertTree(root.right)
  return root
}
```

That is the answer to give first. It is also the one that fails the deep-chain
test: a 50,000-node single-sided tree recurses 50,000 frames deep and overflows.
Say that out loud rather than waiting to be asked, then convert to an explicit
stack, which is the same traversal with the frames moved onto the heap:

```ts
export function invertTree(root: TreeNode | null): TreeNode | null {
  const stack: TreeNode[] = root ? [root] : []
  while (stack.length > 0) {
    const node = stack.pop()!
    const left = node.left
    node.left = node.right
    node.right = left
    if (node.left) stack.push(node.left)
    if (node.right) stack.push(node.right)
  }
  return root
}
```

## Cost

Time O(n) — every node is swapped exactly once. Space O(h) for the recursive
version, where h is the height: O(log n) on a balanced tree and O(n) on a
degenerate chain, which is exactly the failure above. The iterative version is
also O(h) in the worst case, but on the *heap*, where the budget is far larger
than the call stack's.
