# Range Sum Queries — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

The array never changes, and the queries are many. That combination means the
work belongs *before* the queries, not inside them.

Precompute `prefix[i]` = the sum of the first `i` values. Then the sum of any
range is a difference of two of them:

```
sum(from..to) = prefix[to + 1] - prefix[from]
```

Every value in `from..to` is counted once by `prefix[to+1]` and the values before
`from` are counted once by each and cancel. One subtraction, regardless of how
wide the range is.

## Reference solution

```ts
export function rangeSums(values: number[], queries: [number, number][]): number[] {
  const prefix = new Array<number>(values.length + 1).fill(0)
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!
  return queries.map(([from, to]) => prefix[to + 1]! - prefix[from]!)
}
```

The `+ 1` offset — `prefix` has `n + 1` entries and `prefix[0] = 0` — is the
detail worth being deliberate about. It is what makes a range starting at index 0
need no special case, and `prefix[to] - prefix[from]` (the off-by-one) is wrong
on every range while looking entirely reasonable.

## Cost

O(n) precomputation and O(1) per query, so O(n + q) overall with O(n) extra
space. Summing on arrival is O(n) per query, so O(n·q).

## What the suite was testing

A scale test: 200,000 queries each spanning most of a 200,000-element array, on
the order of 10¹⁰ additions for the per-query version against one pass plus
200,000 subtractions.

Every value in the scale fixture is `1`, so the expected answer for `[from, to]`
is exactly `to - from + 1`. That is deliberate — any other fixture would need
the test to precompute prefix sums to know the expected answers, which is
re-implementing the reference inside its own test. The ranges are still varied
and seeded, so nothing about *which* range is asked can be assumed; the varied
values live in the correctness block, and the two blocks together cover what one
fixture cannot.

## The tell

**A static array plus repeated range questions.** "The array does not change
between queries" in a problem statement is an instruction. Precompute.

The generalisation is worth holding on to: prefix sums answer range questions for
any operation with an inverse — sums, XOR, counts. For operations without one
(minimum, maximum) the difference trick fails and you need a sparse table or a
segment tree instead. And if the array *does* change between queries, prefix sums
are the wrong structure entirely, because every update invalidates a suffix of
them.
