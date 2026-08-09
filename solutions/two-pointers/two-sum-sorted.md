# Two Sum (Sorted) — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

The array is sorted, and that is the whole gift. Put one index at each end and
look at their sum. It is either the target — done — or it is too small, or too
big. In each of those two cases *one* of the two indices is provably useless
where it stands:

- If the sum is too small, no partner for `numbers[lo]` exists anywhere. Its
  best possible partner is the largest value in the range, which is
  `numbers[hi]`, and even that fell short. So `lo` can never be part of the
  answer within this range, and moving it right loses nothing.
- If the sum is too big, the mirror argument retires `hi`.

Each step therefore eliminates one index permanently, so the range shrinks by
one per comparison and the scan is linear. That elimination argument is the
proof of correctness, not just the intuition — it is what lets you discard a
whole row of the pair matrix on a single comparison.

## Reference solution

```ts
export function twoSum(numbers: number[], target: number): [number, number] | null {
  let lo = 0
  let hi = numbers.length - 1
  while (lo < hi) {
    const sum = numbers[lo]! + numbers[hi]!
    if (sum === target) return [lo, hi]
    if (sum < target) lo++
    else hi--
  }
  return null
}
```

`lo < hi` rather than `lo <= hi` is the one detail that matters. With `<=` the
loop considers the pair `(i, i)` — one position used twice — and the suite tests
exactly that: `twoSum([1, 4, 9], 8)` must be `null`, not `[1, 1]`.

## Cost

Time O(n), space O(1). The brute force is O(n²) time, O(1) space.

## What the suite was testing

A scale test. At 500,000 elements with the only answer in the last two
positions, checking every pair is 1.25×10¹¹ evaluations — measured at over forty
seconds against a linear sweep's few milliseconds. The fixture uses
`numbers[i] = i` so the largest reachable sum, `(n-1) + (n-2)`, is reachable by
exactly one pair; the answer is known by construction rather than searched for.

## The tell

**Sorted input, and a question about a pair or a range.** Sorting is either free
information you are meant to exploit or a hint someone left deliberately. When
the input is sorted and you are looking for two things, ask what a comparison at
the two ends lets you *rule out* — a comparison that eliminates a candidate is
worth n times one that merely tests a candidate.
