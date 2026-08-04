# Network Delay Time

There are `n` nodes in a network, labelled `1` through `n`. A list `times`
describes the signal routes between them: each `times[i] = [u, v, w]` means a
signal sent from node `u` reaches node `v` after `w` time units.

A signal is sent from a starting node `k`. Return the amount of time it takes
for **every** node in the network to receive the signal. If any node never
receives it, return `-1`.

## Constraints

- `1 <= k <= n <= 6000`
- `1 <= times.length <= 1_500_000`
- `times[i].length == 3`
- `1 <= u, v <= n` — `u` and `v` are not guaranteed distinct; a route from a
  node back to itself is valid input.
- `1 <= w <= 20000`
- There can be multiple edges between the same pair of nodes, each with its
  own weight — do not assume they're deduplicated.
- **Every edge in `times` is directed**: `[u, v, w]` describes a route from
  `u` to `v` only. It says nothing about a route back from `v` to `u`, and one
  may not exist.
- **Nodes are 1-indexed**, `1..n` — there is no node `0`.
- A solution that is correct but re-scans every edge in `times` once per node
  (or similar repeated-full-pass approaches) will be rejected by this
  problem's test suite, even when it returns the right answer.

## Examples

```
n = 4, k = 2, times = [[2,1,1],[2,3,1],[3,4,1]]
-> 2         (node 3 arrives at time 1, node 4 at time 2 via node 3 — that's
              the last node to receive the signal)

n = 1, k = 1, times = []
-> 0         (the only node is the start; nothing left to wait for)

n = 2, k = 1, times = []
-> -1        (node 2 has no route in, so it never receives the signal)
```

## Signature

```ts
export function networkDelayTime(times: number[][], n: number, k: number): number
```

## A language note

JavaScript's standard library has no built-in structure for repeatedly
pulling the smallest of a changing set of values. If your approach needs
that, you'll be writing it yourself.

## Run it

```bash
pnpm test network-delay     # attempt
pnpm reset network-delay    # start over from a clean stub
```
