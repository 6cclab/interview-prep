# Merge Two Sorted Lists — worked solution

## The tell

Two already-sorted sequences to be combined, and the inputs are nodes rather than
arrays so you cannot index. Whatever you do has to be decided one node at a time
from the two current fronts.

## The observation

At every step the next node of the answer is whichever of the two current heads
is smaller. Take it, advance that list, repeat; when one list runs out, the rest
of the other is already sorted and can be attached wholesale rather than walked.

The thing that makes this fiddly by hand is the *first* node: until you have
picked it you have no list to append to, so every append needs an "is this the
head?" branch. A **dummy head** — a throwaway node whose `next` becomes the real
answer — deletes that branch entirely. Return `dummy.next`.

## Reference solution

```ts
export function mergeTwoSorted(a: ListNode | null, b: ListNode | null): ListNode | null {
  const dummy: ListNode = { val: 0, next: null }
  let tail = dummy
  let left = a
  let right = b

  while (left && right) {
    if (left.val <= right.val) {
      tail.next = left
      left = left.next
    } else {
      tail.next = right
      right = right.next
    }
    tail = tail.next
  }

  tail.next = left ?? right
  return dummy.next
}
```

Two details worth saying out loud in an interview:

- `<=` rather than `<` keeps equal values in a stable order (everything from `a`
  before the equal value from `b`). Either is correct here, but only one of them
  is *stable*, and being asked about it is common.
- `tail.next = left ?? right` covers the tail-attach and the both-empty case at
  once. With both lists empty the loop never runs, `tail` is still `dummy`,
  `dummy.next` stays `null`, and the empty-input case needs no special handling.

## Cost

Time O(n + m) — each node is visited once. Space O(1): the dummy node is a single
allocation and no new nodes are created per element. A version that builds fresh
nodes is O(n + m) space and fails the reuse test.
