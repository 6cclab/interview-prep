# Cycle Start — worked solution

> Spoiler. `prompts/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Let the tail before the cycle have length `a` (the head is `a` steps from
the cycle's entry), let the cycle have length `c`, and let `b` be the
distance from the entry to wherever the two pointers first meet, walking
forward around the cycle.

Run two pointers from the head: a fast one that moves 2 steps for every 1
the slow one takes. If the list has a cycle, they meet somewhere inside it
— the slow pointer cannot lap the fast one, and both are trapped in the
same finite loop, so a meeting is guaranteed.

At the meeting point, the slow pointer has travelled `a + b` steps. The
fast pointer has travelled twice that, `2(a + b)`, and it has also gone
around the cycle some whole number of extra times `k`, so its distance is
also `a + b + kc`. Setting those equal:

```
2(a + b) = a + b + kc
a + b = kc
a = kc - b
```

`a = kc - b` says: walking `b` more steps forward from the meeting point
covers a whole number of laps of the cycle (`kc`) *minus* `a`. Equivalently
— since positions on the cycle only matter modulo `c` — walking forward `a`
steps from the meeting point lands on the same node as walking forward `a`
steps from a point `kc` ahead of the entry, which is the entry itself.

So: place one pointer back at the head, leave the other at the meeting
point, and advance both one step at a time. They are both exactly `a` steps
from the entry — the head-pointer because that's the definition of `a`, the
meeting-point-pointer because of the algebra above — so they reach the
entry simultaneously, and that's where they meet the second time.

## Solution

```ts
export function detectCycleStart(head: ListNode | null): ListNode | null {
  let slow = head
  let fast = head

  while (fast !== null && fast.next !== null) {
    slow = slow!.next
    fast = fast.next.next
    if (slow === fast) {
      let p1 = head
      let p2 = slow
      while (p1 !== p2) {
        p1 = p1!.next
        p2 = p2!.next
      }
      return p1
    }
  }

  return null
}
```

## Complexity

- **Time:** O(n). The first phase does at most n iterations before the fast
  pointer either exits the list (no cycle) or meets the slow pointer. The
  second phase does at most n more.
- **Space:** O(1) — two pointers, no matter how large the list.

## The O(n)-space alternative, and its honest limitation

Walking the list once while inserting each node into a `Set`, and returning
the first node already present, is also correct and also O(n) time:

```ts
export function detectCycleStart(head: ListNode | null): ListNode | null {
  const seen = new Set<ListNode>()
  let cur = head
  while (cur !== null) {
    if (seen.has(cur)) return cur
    seen.add(cur)
    cur = cur.next
  }
  return null
}
```

This repo's test suite **does not distinguish this from the two-pointer
solution above** — the scale test only rejects the O(n^2) re-walk brute
force, not O(n) extra space, because there's no mechanical way to assert a
space bound from outside the function the way `assertWithinBudget` asserts
a call count. Passing this problem's tests is not proof of constant space.
An interviewer asking for constant extra space will not accept it, and
should be expected to ask "can you do this without the set?" as a matter of
course on this exact problem.

## Sibling problems

- **Linked List Cycle (yes/no)** — the first phase alone; no need for the
  second pointer or the algebra above.
- **Find the Duplicate Number** — the same two-phase algorithm applied to
  an array of `n + 1` integers in `[1, n]`, treating `arr[i] -> arr[arr[i]]`
  as the `next` pointer; the pigeonhole principle guarantees a cycle exists.
- **Happy Number** — cycle detection on the "sum of squared digits"
  function instead of a linked list; a non-happy number cycles back to
  itself without ever reaching 1.

## The tell

Linked structure, and the question is about a cycle or "the middle" of the
list, where you can't just ask for the length up front. Reach for two
pointers moving at different speeds through the same structure, and let the
gap between them do the work — meeting proves a cycle exists; the algebra
above turns that meeting into the entry point.

## Interview notes

- Say the invariant out loud before coding it: "the distance from the head
  to the entry equals the distance from the meeting point to the entry."
  That sentence is what the interviewer is listening for on this problem —
  it's the whole reason the second phase works, and reciting it is a
  cheaper way to demonstrate understanding than re-deriving the algebra
  live.
- Mention the `Set` approach up front as the obvious O(n)-space baseline,
  then say you can trade it for O(1) space with two pointers — showing you
  know the tradeoff exists is worth more than silently jumping to the
  clever answer.
- Watch the loop guard: `fast !== null && fast.next !== null`, checked in
  that order. Checking `fast.next` before confirming `fast` isn't null
  throws on a list with no cycle.
- Node values repeating in the list is a deliberate trap in this drill —
  identity, not value, is what defines "the same node."
