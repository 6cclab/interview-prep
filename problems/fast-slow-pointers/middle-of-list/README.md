# Middle of a List

Given the head of a singly linked list, return the middle node.

If the list has an even number of nodes there are two middles; return the
**second** one. Return the node itself, not its value or its index.

## Constraints

- `0 <= length <= 100000`
- Return `null` for an empty list
- The list must not be modified
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
1 -> 2 -> 3 -> 4 -> 5        ->  the node holding 3
1 -> 2 -> 3 -> 4             ->  the node holding 3   (second of the two middles)
1                            ->  the node holding 1
(empty)                      ->  null
```

## Signature

```ts
export interface ListNode {
  val: number
  next: ListNode | null
}

export function middleNode(head: ListNode | null): ListNode | null
```

## Run it

```bash
pnpm test middle-of-list     # attempt
pnpm reset middle-of-list    # start over from a clean stub
```
