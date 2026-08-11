# Network Delay Time — worked solution

> Spoiler. `prompts/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

All weights are non-negative. That single fact is what makes one pass enough.

Maintain a set of nodes whose shortest distance from `k` is already known —
"finalised" — and repeatedly pull the **unfinalised** node with the smallest
tentative distance. Once pulled, that node's tentative distance is final and
can never improve.

Why can it never improve? Any other path to it would have to pass through
some unfinalised node `x` first. Because weights are non-negative, the
distance to `x` alone is already `>=` the distance to the node just pulled
(that's why it was pulled first, not `x`) — so continuing from `x` can only
add more non-negative weight on top of something already at least as large.
There's no way for a "later" path through `x` to undercut the node already
pulled.

That's the whole idea: greedily finalise the closest remaining node, once,
and never revisit a finalised node. This is exactly what breaks the moment
a weight can be negative — see below.

## Reference solution

A hand-rolled binary min-heap, keyed on tentative distance, does the
"repeatedly pull the smallest" part. JavaScript has no built-in priority
queue, so this is written by hand rather than imported.

```ts
class MinHeap {
  private readonly heap: [dist: number, node: number][] = []

  get size(): number {
    return this.heap.length
  }

  push(dist: number, node: number): void {
    this.heap.push([dist, node])
    let i = this.heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[parent]![0] <= this.heap[i]![0]) break
      ;[this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!]
      i = parent
    }
  }

  pop(): [dist: number, node: number] {
    const top = this.heap[0]!
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let smallest = i
        if (left < this.heap.length && this.heap[left]![0] < this.heap[smallest]![0]) smallest = left
        if (right < this.heap.length && this.heap[right]![0] < this.heap[smallest]![0]) smallest = right
        if (smallest === i) break
        ;[this.heap[i], this.heap[smallest]] = [this.heap[smallest]!, this.heap[i]!]
        i = smallest
      }
    }
    return top
  }
}

export function networkDelayTime(times: number[][], n: number, k: number): number {
  const adj: [node: number, weight: number][][] = Array.from({ length: n + 1 }, () => [])
  for (const [u, v, w] of times) adj[u!]!.push([v!, w!])

  const dist = new Array<number>(n + 1).fill(Infinity)
  dist[k] = 0

  const heap = new MinHeap()
  heap.push(0, k)

  const finalised = new Array<boolean>(n + 1).fill(false)
  let seen = 0

  while (heap.size > 0) {
    const [d, u] = heap.pop()
    if (finalised[u]) continue // a stale, superseded heap entry
    finalised[u] = true
    seen++

    for (const [v, w] of adj[u]!) {
      const cand = d + w
      if (cand < dist[v]!) {
        dist[v] = cand
        heap.push(cand, v)
      }
    }
  }

  if (seen < n) return -1

  let max = 0
  for (let node = 1; node <= n; node++) max = Math.max(max, dist[node]!)
  return max
}
```

Two details worth naming out loud:

- **Lazy deletion.** The heap can hold multiple stale entries for the same
  node (pushed each time a cheaper distance is found). Rather than trying to
  decrease a key in place — awkward with an array-backed heap — just skip an
  entry when it's popped and the node is already finalised. The heap can
  temporarily hold up to `E` entries instead of `V`, which doesn't change the
  asymptotic bound.
- **`seen < n` is the unreachable check**, not scanning `dist` for
  `Infinity`. Both work; `seen` avoids a second full pass.

## Complexity

- **Time:** O((V + E) log V). Each of the `E` edges can push once, each push
  and pop is O(log V) against a heap that holds at most O(E) entries, and
  every node is finalised at most once.
- **Space:** O(V + E) for the adjacency list, distance array, and heap.

## Why the answer is a max, not a sum

The question asks for the moment the **last** node receives the signal, not
the total time spent relaying it. Every node hears the signal at
`dist[node]` — its own shortest arrival time, independent of when its
neighbors hear it. The network is "done" the instant the slowest of those
arrivals happens, i.e. `max(dist[1..n])`. Summing would double- and
triple-count time that overlaps: nodes receive their signals in parallel
along independent paths, not one after another.

## When Bellman-Ford is actually the right tool

The greedy argument above depends entirely on weights being non-negative. If
a negative weight is possible, the node just popped as "closest so far" is
no longer guaranteed final — a longer-looking path through a negative edge
could still undercut it later, after it's already been marked done. Dijkstra
gives a wrong answer silently in that case; it doesn't error.

Bellman-Ford instead relaxes every edge, `V - 1` times over, without ever
assuming a distance is final until the last pass. That's strictly more
work — O(V·E) instead of O((V + E) log V) — but it's correct with negative
weights, and it can also detect negative cycles (a distance that keeps
shrinking on the `V`-th pass means the graph has no well-defined shortest
path at all). Reach for it when the problem allows negative edges, not by
default.

## Sibling problems

- **Cheapest Flights Within K Stops** — same shortest-path shape, but with a
  hop budget. Dijkstra's greedy finality breaks here too (a costlier-but-fewer-hops
  path can dominate later), so this one is usually solved with a bounded
  Bellman-Ford variant instead.
- **Path With Minimum Effort / binary-search-on-answer over a grid** — a
  different cost model (minimize the max edge on a path, not the sum), but
  the same "repeatedly expand the best-so-far frontier" instinct applies.

## The tell

Weighted edges, asked for a minimum cost or minimum time to reach
somewhere (or everywhere), with weights that are all given as non-negative.
That combination is the cue to reach for a "expand the closest unfinished
node first" approach backed by a structure that can repeatedly hand you the
current minimum — not to write a fixed number of full passes over every
edge.

## Interview notes

- Say "non-negative weights" out loud before committing to the approach —
  it's the one sentence that justifies skipping Bellman-Ford, and
  interviewers listen for whether you know *why* it's safe, not just that a
  library function exists.
- Mention up front that JavaScript has no built-in priority queue, and that
  you're either writing a small binary heap or falling back to an O(V^2)
  scan for the minimum each round if a heap feels too risky to write live
  under pressure. Naming the tradeoff is worth more than silently attempting
  a heap and running out of time.
- State the max-not-sum framing before coding the final reduction — it's a
  common one-line bug (returning the sum, or the last-pushed distance,
  instead of the max over all finalised distances).
- Handle the unreachable case explicitly and say how: either every node gets
  finalised or it doesn't, and that's checkable without re-scanning for
  `Infinity`.
