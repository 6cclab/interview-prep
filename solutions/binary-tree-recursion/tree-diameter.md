# Tree Diameter — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/binary-tree-recursion/tree-diameter/` or given up on it for the
session.

## The observation

The diameter of a tree — the longest path between any two nodes — is, for
every node you visit, one of two things: it's entirely inside the left
subtree, entirely inside the right subtree, or it passes *through* the node
you're standing on, in which case its length is `height(left) +
height(right) + 2` (the height of each side, in edges, plus the two edges
connecting each subtree's deepest node up to this one).

So the answer is `max` over every node of "the longest path that passes
through this node." A brute-force reading of that says: for every node,
compute `height(left)` and `height(right)` from scratch, and keep a running
max. That's correct — it does explore every node as the potential "peak" of
the winning path — but computing height by walking back down to the leaves
at every single node is redundant. `height()` at a node one level down is
almost the same work as `height()` at the node above it; a fresh top-to-
bottom walk throws that away and starts over.

The fix is the pattern's core move: define what a single recursive call
returns for a subtree, and get *two* things out of the same traversal. Have
the recursive function return the subtree's height, and — as a side effect,
on the way back up — update a running best whenever `leftHeight +
rightHeight` (the path through the current node) beats it. The value being
computed (height) and the value being asked for (diameter) are different
quantities, but the second rides along for free on top of the first. One
post-order traversal, and every node is visited exactly once.

This is the reusable idea, independent of this specific problem: whenever a
tree question needs two different things from each subtree — one to return
upward so the parent can use it, and one to fold into a global answer as you
pass through — a single post-order traversal computing the first
automatically gives you a place to update the second. The final answer is
often a side effect of computing something else, not the thing being
directly computed.

## Reference solution

```ts
export function diameterOfBinaryTree(root: TreeNode | null): number {
  let best = 0

  function height(node: TreeNode | null): number {
    if (node === null) return -1
    const leftHeight = height(node.left)
    const rightHeight = height(node.right)
    const throughNode = leftHeight + rightHeight + 2
    if (throughNode > best) best = throughNode
    return 1 + Math.max(leftHeight, rightHeight)
  }

  height(root)
  return best
}
```

`height()` returns a node's height in edges, using `-1` for `null` so a leaf
comes out to `0`. `throughNode` is the length, in edges, of the longest path
that uses this node as its peak: one edge down to the bottom of the left
subtree (`leftHeight` edges) plus one edge down to the bottom of the right
subtree (`rightHeight` edges) plus the two edges connecting them to this
node — hence `+ 2`, not `+ 1`.

## Complexity

- Time: `O(n)` — one post-order traversal, each node visited once.
- Space: `O(h)` for the call stack, where `h` is the tree's height — `O(log
  n)` for a balanced tree, `O(n)` in the worst case (a skewed chain, exactly
  the shape the test suite's scale case uses).

## Why the naive version is O(n²) — specifically on skewed trees

If instead you call a standalone `height()` (a fresh top-to-bottom
traversal) at every node during a separate outer walk, the cost at each
node is proportional to the height of the subtree rooted there. Summed over
every node, that's `n + (n-1) + (n-2) + ... + 1 = O(n²)` in the worst case.

That worst case is a **skewed chain**, not a balanced tree. On a balanced
tree, most nodes are near the bottom with small subtrees, so the same sum
comes out to `O(n log n)` — enough overhead to notice, but not enough to
time out a test suite. On a left- or right-skewed chain, the top node's
`height()` call alone walks the entire rest of the chain, the next node's
walks almost all of it, and so on: the sum degrades to the full `O(n²)`.
That's exactly why a scale test for this problem has to use a skewed chain,
not a balanced one, to force a real gap between the two approaches.

## The edges-vs-nodes trap

The single most common mistake here is counting nodes instead of edges. A
path through `k` nodes has `k - 1` edges. If `height()` is defined so that a
leaf returns `1` (its node count) rather than `0` (its edge count), diameter
comes out one too high at every peak, or you have to remember to subtract
somewhere and it's easy to get inconsistent about where. Defining `height()`
to return `-1` for `null` is what makes a leaf come out to `0` cleanly and
keeps every `+2` at a peak node correct without a separate off-by-one
correction.

## Sibling problems (same pattern)

- **Maximum Depth of Binary Tree**: the `height()` half of this problem on
  its own, with no side-channel max to track. A good warmup if the
  height-computation part feels shaky.
- **Balanced Binary Tree**: same "return one thing, fold in a global check
  as a side effect" shape — return height, but bail out (or record) as soon
  as a subtree's left/right heights differ by more than 1.
- **Longest Univalue Path**: nearly identical to this problem, but the
  "runs" being measured have to share the same node value, so the returned
  quantity is "longest same-value run ending at this node" instead of
  height.
- **Binary Tree Maximum Path Sum**: the general version of this same
  side-channel idea — return the best single-direction sum a parent could
  use, update a global best with the "peak here" combination, except sums
  can go negative so you also have to decide whether to include a subtree
  at all.

## The tell

Any tree question where the answer needs two different things out of each
subtree: one value the parent needs in order to compute its own answer (a
height, a sum, a run length), and a second, global quantity that gets
checked or updated at every node using values from *both* children at once.
If you find yourself wanting to call the same helper function multiple
times per node — once for context, again for the actual check — that's the
signal to fold both into one traversal instead.

## Interview notes

- State the two-things-at-once idea before coding: "I'll return height so
  the parent can use it, and update a running max diameter as a side effect
  on the way back up." That sentence is the entire insight; the
  implementation is short once it's said.
- Say up front that the answer is measured in edges, and that a leaf has
  height 0 — interviewers are listening for whether you've actually
  thought about the off-by-one, not just gotten lucky with a symmetric test
  case.
- Don't forget the case where the diameter doesn't pass through the root at
  all — it can live entirely inside one subtree, e.g. when the tree is
  lopsided. A solution that only ever checks `height(root.left) +
  height(root.right)` once, rather than at every node, will pass a
  symmetric example and quietly fail this one.
- Worth naming out loud once you're done: the naive `height()`-at-every-node
  version is fine on a roughly balanced tree (`O(n log n)`) and only really
  falls apart on a skewed one (`O(n²)`) — knowing *when* the naive version
  degrades, not just that it can, is the kind of detail that separates
  "got the right answer" from "understands the cost."
