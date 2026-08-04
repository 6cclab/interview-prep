# Merge Intervals — worked solution

> Spoiler. `.claude/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Once the intervals are arranged by start, the only interval that can still
overlap the one you're looking at is the **most recently merged** one. Nothing
earlier can reach forward past it — if some earlier interval could still
overlap the current one, it would already have been merged into the running
interval instead of being left behind.

That collapses "check every pair" into a single left-to-right pass with one
running interval:

- If the current interval's start is `<=` the running interval's end (they
  overlap or touch), fold it in.
- Otherwise the running interval is finished — emit it and start a new one.

The one place people get sloppy: folding in doesn't mean "take the new
interval's end." It means `end = max(runningEnd, currentEnd)`.

## Solution

```ts
export type Interval = [number, number]

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const ordered = intervals.map((iv): Interval => [iv[0], iv[1]])
  ordered.sort((a, b) => a[0] - b[0])

  const merged: Interval[] = []
  for (const [start, end] of ordered) {
    const last = merged[merged.length - 1]
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  return merged
}
```

Note the input is copied (`intervals.map(...)`) before arranging, and the
copies — not the caller's original pairs — are the ones ever mutated. The
caller's array and its interval tuples are untouched.

## Complexity

- **Time:** O(n log n), dominated by the initial ordering pass. The merge
  pass itself is a single O(n) walk.
- **Space:** O(n) for the output (and the ordering, if you don't sort
  in place on the copy).

## Why the containment case breaks `end = current.end`

Take `[[1, 10], [2, 3]]`. Ordered by start, that's already the given order.
Walk it naively taking `end = current.end` on every fold-in:

- Start running interval at `[1, 10]`.
- `[2, 3]` starts inside it (`2 <= 10`), so fold in — but naively set
  `end = 3`. Running interval is now `[1, 3]`.

`[1, 3]` has silently discarded `[3, 10]` — the true answer is `[1, 10]`,
because `[2, 3]` is entirely swallowed by the first interval and should
change nothing. The fix is `end = max(runningEnd, currentEnd)`, which leaves
`10` in place since `10 > 3`.

This is the single most common bug on this problem, and it's invisible on
any input where every interval's end is greater than the one before it —
which is why the test suite specifically includes a containment fixture
where a later interval's end is smaller.

## Why brute force fails

The rejected approach — scan all pairs, merge the first overlapping pair
found, restart the scan, repeat until nothing overlaps — does roughly O(n)
restarts (each restart collapses two intervals into one, so you need close to
n of them to reach a single interval), and each restart's scan is up to
O(n^2) in the worst case. It's re-discovering, one pair at a time and with
repeated re-scanning, the same adjacency the single ordered pass gets for
free.

## Sibling problems sharing this pattern

- **Insert Interval** — same running-interval idea, but the new interval is
  inserted before the walk rather than being part of the input already.
- **Meeting Rooms I/II** — arrange by start, then track how many meetings are
  simultaneously open (a running count or a min-heap of end times) instead of
  merging.
- **Employee Free Time** — merge everyone's busy intervals first (this exact
  problem), then read the gaps between what's left.

## The tell

"Merge," "overlap," or "meetings/calendars" with a list of `[start, end]`
pairs. The moment you'd otherwise reach for checking every pair against every
other pair, ask whether arranging by start first makes the overlap check
local — needing to compare only against the most recent survivor instead of
everything seen so far.

## Interview notes

- Say out loud that arranging by start is what turns "check all pairs" into
  "check only the previous one" — interviewers are listening for that
  causal link, not just the fact that you happened to order the input first.
- State the touching-interval convention explicitly before coding
  (`<=` vs `<` at the boundary) — it's the most common place candidates get
  asked "wait, what should happen here?" mid-interview.
- Say `max(runningEnd, currentEnd)` out loud, not just "the later end" — it's
  easy to write `current.end` on autopilot and only notice on a containment
  case, if you notice at all.
