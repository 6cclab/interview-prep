# Reverse a Linked List — worked solution

> **Spoilers.** Do not read this during an attempt.

> Warm-up tier: correctness only. There is no cost trap here.

## The observation

Walk the list once, and as you pass each node point its `next` at the node you
just came from. You need three references to do that without losing the rest of
the list: the node before, the node you are on, and the node after — and you must
save the node after *before* overwriting `next`, because overwriting it is how you
lose the remainder.

## Reference solution

```ts
export function reverseList(head: ListNode | null): ListNode | null {
  let previous: ListNode | null = null
  let current = head
  while (current) {
    const next = current.next   // save before overwriting
    current.next = previous
    previous = current
    current = next
  }
  return previous
}
```

`previous` starts at `null`, which is what terminates the reversed list — the
original head becomes the tail and ends up pointing at `null` for free. The loop
returns `previous` and not `current`, because `current` is `null` when the loop
exits.

## Cost

Time O(n), space O(1). The recursive version is also O(n) time but O(n) stack,
which is worth naming: at 5,000 nodes it is fine, at 500,000 it overflows.

## The tell

Nothing to spot — this is the pointer-manipulation warm-up. What it tests is
whether you can hold three moving references straight while writing, which is a
different skill from recognising a pattern and the reason it opens interviews.
