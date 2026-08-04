# Redundant Connection

A graph starts as a tree with `n` nodes, labelled `1` through `n`. A single
extra edge is then added on top of that tree, so the graph ends up with `n`
edges total instead of the `n - 1` a tree of that size would have.

You are given the edge list, in the order the edges were added. Every edge is
**undirected** — `[a, b]` and `[b, a]` mean the same connection, and there's
no notion of direction between the two endpoints. Return the one edge that
can be deleted so that the remaining graph is again a tree on all `n` nodes
(connected, with no cycle).

## Constraints

- Nodes are **1-indexed**: labels run `1..n`, never `0`.
- `3 <= n <= edges.length <= 100000` — a graph needs at least three nodes
  before an extra edge can close a cycle.
- Each edge is `[a, b]` with `1 <= a, b <= n` and `a !== b`. Self-loops
  (an edge from a node to itself) do not occur in this problem's inputs —
  a tree never contains one, and the one extra edge added on top is a
  connection between two distinct existing nodes, not a loop back onto
  itself.
- The input is guaranteed to describe a tree plus exactly one extra edge —
  never zero extra edges, never two or more.
- A solution that returns the correct edge is **not automatically good
  enough**. This problem's test suite also measures how the solution
  behaves as the graph grows, and a solution that does noticeably more work
  than necessary to answer will be rejected by that measurement even when
  every individual answer it produces is correct.

## Tie-break: return the LAST valid edge

More than one edge can be "the one that would restore a tree if removed."
Consider:

```
edges = [[1,2],[1,3],[2,3]]
```

Removing `[2,3]` leaves `[[1,2],[1,3]]` — a valid tree (a path through
node 1). But removing `[1,3]` instead leaves `[[1,2],[2,3]]` — also a valid
tree (a path through node 2). Both choices work in isolation.

When that happens, return whichever of the valid choices appears **last**
in the input `edges` array — here that's `[2,3]`, since it comes after
`[1,3]` in the list.

## Examples

```
edges = [[1,2],[1,3],[2,3]]
-> [2,3]

edges = [[1,2],[2,3],[3,4],[1,4],[1,5]]
-> [1,4]
```

## Signature

```ts
export function findRedundantConnection(
  edges: [number, number][],
): [number, number]
```

The returned pair should preserve the orientation `[a, b]` exactly as it
appeared in the input `edges` array — don't swap or re-sort the two node
labels.

## Run it

```bash
pnpm test redundant-connection     # attempt
pnpm reset redundant-connection    # start over from a clean stub
```
