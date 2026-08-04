# Cycle Start

You are given the head of a singly linked list. Return the node where a
cycle begins, or `null` if the list has no cycle. Do not modify the list.

A cycle means some node's `next` pointer, followed repeatedly, eventually
leads back to a node that has already been visited — there is no proper
`null`-terminated tail.

## Constraints

- `0 <= number of nodes <= 200000`
- Node values are **not** guaranteed to be unique. Do not use a node's
  value to identify it — identify nodes by reference.
- At most one cycle. If a cycle exists, it does not have to include the
  head.
- Your solution may use only a small, fixed amount of extra memory — it may
  not allocate a structure (array, map, set, ...) whose size grows with the
  length of the list.
- A solution that, for every node, re-walks the list from the head to check
  whether that node was already visited will be rejected by this problem's
  test suite, even when it returns the correct node.

## Examples

```
1 -> 2 -> 3 -> 4 -> 5 -> 2   (5's next points back to the node holding 2)
-> the node holding 2

1 -> 2 -> 3 -> null
-> null

1 -> 1   (the single node's next points at itself)
-> the node holding 1

[] (empty list)
-> null
```

The first example uses distinct values only to make the diagram readable —
nothing about the problem depends on values being unique.

## Signature

```ts
export interface ListNode {
  val: number
  next: ListNode | null
}

export function detectCycleStart(head: ListNode | null): ListNode | null
```

## Run it

```bash
pnpm test cycle-start     # attempt
pnpm reset cycle-start    # start over from a clean stub
```
