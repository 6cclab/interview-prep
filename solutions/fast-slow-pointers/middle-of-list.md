# Middle of a List — worked solution

## The tell

You need a position defined relative to the length — and on a linked list the
length is not something you know without walking. Any time the target position
depends on a total you would have to measure first, ask whether something can
measure it *while* you travel.

## The observation

Two cursors from the head, one advancing one node per step and one advancing two.
When the fast cursor reaches the end, it has covered twice as much ground, so the
slow cursor is halfway. One pass, and the length is never computed.

Which middle you land on for even lengths is decided entirely by the loop
condition, and this is the part to get right deliberately rather than by
adjusting until the test passes:

- `while (fast && fast.next)` — slow ends on the **second** middle. (What this
  problem asks for.)
- `while (fast.next && fast.next.next)` — slow ends on the **first** middle.

## Reference solution

```ts
export function middleNode(head: ListNode | null): ListNode | null {
  let slow = head
  let fast = head
  while (fast && fast.next) {
    slow = slow!.next
    fast = fast.next.next
  }
  return slow
}
```

An empty list returns `null` without a special case: the loop body never runs and
`slow` is still `head`.

## Cost

Time O(n). Space O(1).

Note what is *not* the point here. Counting the length in one pass and then
walking `⌊n/2⌋` nodes in a second pass is also O(n) time and O(1) space — it is
a correct answer, and it is why this problem sits in the warm-up tier with no
cost assertion. The two-cursor version saves a constant factor and, more
importantly, is the same mechanism that later solves cycle detection and
"remove the k-th from the end," where a second pass genuinely is not available.
