# Reverse a Linked List

Given the head of a singly linked list, reverse it and return the new head.

You may relink the existing nodes; you do not need to allocate new ones.

## Constraints

- `0 <= list length <= 5000`
- Relinking the given nodes is allowed
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
1 -> 2 -> 3 -> null
=> 3 -> 2 -> 1 -> null

null
=> null
```

## Signature

```ts
export function reverseList(head: ListNode | null): ListNode | null
```

## Run it

```bash
pnpm test reverse-list     # attempt
pnpm reset reverse-list    # start over from a clean stub
```
