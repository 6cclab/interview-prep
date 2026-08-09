# Contains Duplicate — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

"Have I seen this before?" is a membership question, and membership answered by
scanning is linear per query — which is where the n² comes from. Membership
answered by a hash set is constant per query. That is the entire problem: one
pass, remembering everything seen so far.

The subtler framing, and the one that transfers: comparing every pair asks
`n²/2` questions of the form *are these two equal*, but the array only contains
`n` facts. Any time the comparison count exceeds the information count, there is
a structure that collapses it.

## Reference solution

```ts
export function hasDuplicate(values: number[]): boolean {
  const seen = new Set<number>()
  for (const value of values) {
    if (seen.has(value)) return true
    seen.add(value)
  }
  return false
}
```

The one-liner `new Set(values).size !== values.length` is also correct and also
O(n), and worth saying out loud in an interview — but it always consumes the
whole array, where the loop stops at the first repeat. Say both; the loop is the
better answer when the input is a stream.

## Cost

Time O(n), space O(n). The brute force is O(n²) time, O(1) space — so this is a
genuine trade, and naming it is the point. If the interviewer says space is the
binding constraint, sorting first gives O(n log n) time and O(1) extra space
(when mutation is allowed), which is the right answer to a different question.

## What the suite was testing

A scale test with an **all-distinct** fixture, which is the only case a pairwise
comparison cannot get lucky on — it must run to completion. 500,000 values is
1.25×10¹¹ comparisons, measured at over thirty seconds.

The values are a shuffled permutation built from `mulberry32`, not `0..n-1` in
order, and that is deliberate: an ordered fixture would let "compare each value
with its neighbour" pass, which is wrong on unsorted input. The suite also
asserts `[0, -0]` is a duplicate, because `0` and `-0` are the same number and a
key that distinguishes them reports a false negative.

## The tell

**"Has this appeared before" / "is there any repeat" / "how many times".** Any
question whose answer depends on what you have already seen, asked once per
element, is a hash-set or hash-map question. The cost you are trading away is
space, so say so before you are asked.
