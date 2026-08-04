# Sort Colors — worked solution

> Spoiler. `.claude/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Keep three regions growing from the two ends inward, separated by two
pointers plus the cursor doing the actual scanning:

- `[0, low)` — settled `0`s.
- `[low, mid)` — settled `1`s.
- `[mid, high]` — unexamined.
- `(high, n)` — settled `2`s.

`mid` is the cursor. Look at `get(mid)`:

- `0` — it belongs in the `0` region. Swap it down to `low`, then advance
  **both** `low` and `mid`. Safe to advance `mid` too, because the value that
  came back from `low` is guaranteed to be a `1` (that's the invariant on
  `[low, mid)`), which is exactly what `mid` is allowed to pass over.
- `1` — it's already in the right region. Just advance `mid`.
- `2` — it belongs past `high`. Swap it up to `high`, then shrink `high`.
  **Do not advance `mid`.** The value swapped down from `high` is
  unexamined — it could be another `2` — and `mid` has to look at it before
  moving on.

The loop invariant, restated: everything before `low` is `0`, everything in
`[low, mid)` is `1`, everything after `high` is `2`, and `[mid, high]` is the
only region still unknown. Every iteration either shrinks that unknown region
from the left (`mid` moves) or from the right (`high` moves), so the loop
terminates in at most `n` iterations.

## Solution

```ts
export function sortColors(
  n: number,
  get: (i: number) => number,
  set: (i: number, v: number) => void,
): void {
  let low = 0
  let mid = 0
  let high = n - 1

  while (mid <= high) {
    const v = get(mid)
    if (v === 0) {
      const lowVal = get(low)
      set(low, v)
      set(mid, lowVal)
      low++
      mid++
    } else if (v === 1) {
      mid++
    } else {
      const highVal = get(high)
      set(high, v)
      set(mid, highVal)
      high--
    }
  }
}
```

## Complexity

- **Time:** O(n). Every iteration retires at least one index permanently —
  either `mid` moves right or `high` moves left — so there are at most `n`
  iterations.
- **Space:** O(1). Three integer pointers, no auxiliary array.

## The classic bug: advancing `mid` after a `2`-swap

The single most common mistake on this problem is treating all three
branches symmetrically and incrementing `mid` every time, including after
swapping a `2` down from `high`. That's wrong, and it's wrong for a specific
reason: the value that just arrived at `mid` from `high` has never been
looked at. It could be a `0`, a `1`, or another `2`. If you advance `mid`
past it without inspecting it, you've silently misplaced whatever it was —
most visibly, a `0` that lands in the `1` region and never gets swapped down
to the front.

Contrast that with the `0`-swap: the value that arrives at `mid` from `low`
*is* known, because the loop invariant guarantees `[low, mid)` holds only
`1`s. That's precisely why advancing `mid` is safe in that branch and not the
other. If you can state that asymmetry out loud, you understand the
invariant; if you can't, you're pattern-matching the pointer moves without
the reasoning underneath, and it'll fall apart the moment the problem is
rephrased.

## Why a correct answer isn't enough here

This problem hands you an operation that's cheap to call once and expensive
to call redundantly: reading or writing an index. Two shapes of solution get
the *output* right while doing meaningfully more work than the pass above:

- **Count then overwrite.** Tally how many `0`s, `1`s, and `2`s there are,
  then rewrite the whole thing from the counts. This is O(n) time and looks
  linear on a scale test, which is exactly why a scale test can't catch it —
  but structurally it is two full passes: it must finish reading *everything*
  before it can correctly write *anything*, because the count for index 0
  isn't known until the last element has been tallied. The test suite
  measures this directly: it counts how many reads happen before the first
  write. For the partition above, on a uniformly random 500-item fixture,
  that number is in the single digits across many seeded trials — some early
  index is essentially always a `0` or `2`, forcing an early write. For
  count-then-overwrite, it's always exactly `n`, on every fixture, because
  the two phases can't interleave. Budget: 50. Measured max for the
  reference across 300 trials: 9. Measured value for counting sort: `n`
  exactly (500), every time.
- **Sort by comparison.** Pull everything into a local array, call `.sort()`,
  write it back. Same two-phase shape as counting sort — full read pass,
  then full write pass — so it fails the same budget the same way, for the
  same reason.

There's a subtlety worth knowing about even beyond that: a solution that
avoids the two-phase shape (say, a comparison sort implemented directly
against `get`/`set`, interleaving reads and writes throughout, like bubble
sort) can dodge the read-before-first-write budget entirely — its first swap
usually happens almost immediately — while still doing wildly more total
work than a single pass. That's why the suite asserts a second, independent
budget on total `get()`/`set()` calls combined (3000, against a measured
reference max of 1589 over 300 trials at n=500). Bubble sort on the same
fixture racks up over 300,000. Neither budget alone is sufficient; together
they close off both shapes of cheating.

## Sibling problems

- **Merge sort's merge step** — same "grow settled regions, shrink unknown
  region" shape, with two pointers instead of three.
- **Partition step of quicksort (Lomuto/Hoare)** — the two-way version of
  this exact idea; this problem is the three-way generalization, sometimes
  called the Dutch national flag problem for that reason.
- **Move zeroes to the end** — the two-color special case, usually solved
  with two pointers instead of three.

## The tell

You're asked to rearrange a small, fixed set of categories in place, and
you're told (explicitly or by an expensive-operation constraint) that you
can't afford two full passes. Reach for pointers that mark the boundaries of
settled regions, advance the cursor through the unknown middle, and swap
elements into position as you discover where they belong — never sort them
by comparison, and never characterize the whole input before writing any of
it back.

## Interview notes

- Say the two-pass approach out loud first — it's the obvious one, and
  naming it shows you considered it — then say why it's not what's wanted
  here (two full traversals when one will do) before writing anything.
- Narrate the invariant as you write the loop: what do `[0, low)`,
  `[low, mid)`, and `(high, n)` each guarantee at the top of every iteration?
  If you can't state it, you'll get the `mid`-advancement bug.
- Say out loud, before you write the `2` branch, that `mid` must not move
  there. That's the one line interviewers listen for on this problem.
- Dry-run a small example with all three values and at least one `2`-swap by
  hand before declaring done — it's the cheapest way to catch the
  advancement bug yourself instead of in the room.
