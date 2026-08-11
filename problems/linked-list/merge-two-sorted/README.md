# Merge Two Sorted Lists

Given the heads of two sorted singly linked lists, splice them into one sorted
list and return its head. Reuse the existing nodes by relinking them rather than
allocating new ones.

Both inputs are sorted ascending. Either may be empty.

## Constraints

- `0 <= length of each list <= 50000`
- Values may be negative, and may repeat across the two lists
- Relinking the input nodes is allowed and expected
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
a = 1 -> 2 -> 4
b = 1 -> 3 -> 4
    ->  1 -> 1 -> 2 -> 3 -> 4 -> 4

a = (empty)
b = 0
    ->  0

a = (empty)
b = (empty)
    ->  (empty)
```

## Signature

```ts
export interface ListNode {
  val: number
  next: ListNode | null
}

export function mergeTwoSorted(a: ListNode | null, b: ListNode | null): ListNode | null
```

## Run it

```bash
pnpm test merge-two-sorted     # attempt
pnpm reset merge-two-sorted    # start over from a clean stub
```
