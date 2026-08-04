# Redundant Connection — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/union-find/redundant-connection/` or given up on it for the
session.

## The core observation

A tree on `n` nodes has exactly `n - 1` edges and no cycles. This graph has
`n` edges — one too many — which means exactly one cycle exists somewhere in
it, and the edge to delete is any edge on that cycle. The tie-break rule
("return the last valid edge") pins down exactly which one.

Here's the key move: don't think of the graph as a static structure to
analyze after the fact. Think of it as being *built*, one edge at a time, in
the order given. Maintain, incrementally, which nodes are already connected
to which other nodes as each edge is added. For each edge `[a, b]`:

- If `a` and `b` are **not yet connected**, adding this edge is fine — it
  merges two previously-separate components into one, exactly like a normal
  tree-building step.
- If `a` and `b` are **already connected** (there's already some path
  between them through earlier edges), this edge is redundant — it's the
  one closing a cycle. Adding it doesn't connect anything new.

The first edge encountered where both endpoints are already connected is a
valid answer: removing it breaks the one cycle it closes. Because a tree plus
one edge has only one cycle total, and edges are processed strictly in input
order, the *last* such edge encountered while scanning is also the last
"already connected" edge overall — which is exactly the tie-break the
problem asks for. No separate bookkeeping is needed to satisfy it: scanning
once, left to right, and remembering the most recent redundant edge found
does it for free.

The remaining design question is how to answer "are `a` and `b` already
connected?" cheaply, and how to merge two components together cheaply, for
up to 100,000 edges. That's the union-find (disjoint set union) data
structure: each component has one designated representative, `find(x)`
walks up to a node's representative, and `union(a, b)` merges the two
representatives when they differ.

## Reference implementation

```ts
function makeUnionFind(n: number) {
  const parent = new Int32Array(n + 1)
  for (let i = 0; i <= n; i++) parent[i] = i
  const rank = new Uint8Array(n + 1)

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]! // path compression: point one level up
      x = parent[x]!
    }
    return x
  }

  function union(a: number, b: number): boolean {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return false // already connected — this is a redundant edge

    if (rank[ra]! < rank[rb]!) {
      parent[ra] = rb
    } else if (rank[ra]! > rank[rb]!) {
      parent[rb] = ra
    } else {
      parent[rb] = ra
      rank[ra]!++
    }
    return true
  }

  return { union }
}

export function findRedundantConnection(edges: [number, number][]): [number, number] {
  const n = edges.length // a tree + one edge has as many edges as nodes
  const { union } = makeUnionFind(n)

  let answer: [number, number] | null = null
  for (const [a, b] of edges) {
    if (!union(a, b)) answer = [a, b]
  }

  return answer! // guaranteed to be set: the input always contains exactly one cycle
}
```

## Complexity

- Time: near-constant per `find`/`union` call, amortized — specifically
  `O(inverse-Ackermann(n))`, a function that grows so slowly it's under 5
  for any `n` that could ever come up in practice. For `E` edges, total time
  is effectively `O(E)`.
- Space: `O(n)` for the `parent` and `rank` arrays.

## What each optimization buys

- **Union by rank** (attach the shallower tree under the deeper one's root,
  never the other way): without it, an adversarial sequence of unions can
  build a structure that's a straight chain `n` deep, making every `find`
  call `O(n)`. With it alone (no path compression), the tree depth is
  bounded at `O(log n)`, so `find` and `union` are `O(log n)`.
- **Path compression** (during `find`, point every visited node directly at
  the root): without it, repeated `find` calls on the same node keep
  re-walking the same path. With it alone (no union by rank), the amortized
  cost is still very good — close to `O(log n)` amortized — because the
  tree gets flattened as it's used.
- **Both together**: the two optimizations compound. Rank keeps trees
  shallow to begin with; compression flattens whatever depth remains,
  permanently, for every future query. Together they give the
  inverse-Ackermann bound — the two are usually implemented together
  specifically because there's essentially no cost to including both and
  the combined bound is meaningfully better than either alone.

## Why the O(E·V) approach is a trap

The brute-force instinct is: for each edge, remove it, then check whether
the rest of the graph is a valid tree (connected, no cycle) with a full
graph traversal. That's correct, but it repeats a full traversal of a graph
with up to 100,000 nodes once per edge — up to 100,000 times. It also throws
away the fact that this problem is fundamentally about *incremental*
connectivity: you already know everything about the graph built from edges
`1..k` by the time you're deciding about edge `k+1`. Re-deriving that from
scratch on every edge is the wasted work the incremental approach avoids
entirely.

## Sibling/related problems

- **Number of Provinces**: given an adjacency matrix, count connected
  components — a direct count of the number of distinct representatives
  after unioning every connection.
- **Accounts Merge**: union accounts that share an email, then group by
  representative — same incremental-merge shape, with strings as the
  "nodes" instead of integers.
- **Redundant Connection II**: the directed version, where edges have a
  direction and a node can have at most one parent in a valid tree. Much
  trickier — a node can end up with two parents, or the removed edge can be
  the one that both closes a cycle *and* gives some node two parents, and
  telling those cases apart takes real care.
- **Graph Valid Tree**: given `n` nodes and a list of edges, decide whether
  they form a valid tree — same connectivity tracking, phrased as a
  yes/no question instead of "which edge to remove."
- **Number of Islands**: usually solved with grid flood-fill, but it's also
  a clean fit for this technique — union each land cell with its land
  neighbors, and the answer is the number of distinct representatives among
  land cells.

## The tell

Watch for problems that describe connectivity queries or merges arriving
**one at a time**, especially phrased as "process these in order and answer
as you go," or where the question is fundamentally "are these two things
already in the same group?" repeated many times as the group structure
evolves. If the naive approach would be to re-scan or re-traverse the whole
structure on every query, and the queries only ever *merge* groups (never
split them), that's the signal — incremental connectivity with merges but no
splits is exactly what this structure is built for.

## Interview notes

- Common mistake: forgetting path compression, union by rank, or both, and
  writing plain `find`/`union` with no balancing. It's still correct, just
  slow on adversarial input — worth mentioning out loud even if you don't
  code the optimized version immediately, since it shows you know the
  degenerate case exists.
- Common mistake: computing `n` wrong. For this problem specifically,
  `edges.length` already equals `n`, since a tree-plus-one-edge on `n` nodes
  has exactly `n` edges — no need to scan for the maximum node label. That
  shortcut is specific to this problem's guarantee, though; in a more
  general setting where node numbering could be sparse or unbounded, sizing
  the underlying array off `edges.length` instead of the true node count
  would be the bug.
- Say the incremental-answer argument out loud: "the last edge that
  connects two nodes already in the same group is the answer, because
  that's the same as the last redundant edge scanned in order" — this is
  the part that actually explains *why* a single left-to-right pass gives
  the tie-break for free, and it's easy to get the right code without ever
  articulating why it's right.
- Likely follow-ups: "what if the graph could have more than one extra
  edge?" (the incremental check generalizes — every redundant edge gets
  caught the same way, there just isn't a single unique answer anymore);
  "what if edges were directed?" (that's Redundant Connection II, and the
  simple version breaks); "what's the worst case without the two
  optimizations?" (near-linear chains degrade `find` to `O(n)` per call).
