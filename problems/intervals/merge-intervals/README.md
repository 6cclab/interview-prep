# Merge Intervals

You are given a list of intervals, each `[start, end]` with `start <= end`.
The list may be in any order and may contain overlapping intervals.

Merge all intervals that overlap and return the smallest list of intervals
that covers the same ranges, ordered by start value from smallest to largest.

**Touching counts as overlapping.** If one interval ends exactly where another
begins, merge them. For example, `[1, 4]` and `[4, 5]` merge into `[1, 5]` —
they are not returned as two separate intervals.

Your function must not mutate the `intervals` array (or the pairs inside it)
that was passed in. The caller may still need the original data afterward.

## Constraints

- `0 <= intervals.length <= 200000`
- `-10^9 <= start <= end <= 10^9`
- A solution that repeatedly scans for a pair of overlapping intervals,
  merges them, and restarts until nothing overlaps will be rejected by this
  problem's test suite, even when it returns the correct answer.

## Examples

```
intervals = [[1,3],[2,6],[8,10],[15,18]]
-> [[1,6],[8,10],[15,18]]

intervals = [[1,4],[4,5]]
-> [[1,5]]            (touching intervals merge)

intervals = [[1,10],[2,3]]
-> [[1,10]]            (the second interval is fully inside the first)

intervals = []
-> []
```

## Signature

```ts
export type Interval = [number, number]

export function mergeIntervals(intervals: Interval[]): Interval[]
```

The returned intervals must be free of overlaps or touching pairs, ascending
by start value.

## Run it

```bash
pnpm test merge-intervals     # attempt
pnpm reset merge-intervals    # start over from a clean stub
```
