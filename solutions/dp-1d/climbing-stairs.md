# Climbing Stairs — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

Ask what the *last* move was. Any sequence reaching step `n` ended with either a
1-step from `n-1` or a 2-step from `n-2`, those two sets are disjoint (they end
differently) and together they are all of them. So:

```
ways(n) = ways(n - 1) + ways(n - 2)
```

with `ways(1) = 1` and `ways(2) = 2`. That recurrence is the whole answer, and it
is Fibonacci shifted by one.

The recurrence alone is not the drill, though. Written as plain recursion it
re-derives the same subproblems exponentially many times — the call count is
itself roughly the answer, which grows at 1.6ⁿ. Each subproblem has one answer,
so compute it once. There are `n` subproblems and each needs only the two before
it, so a rolling pair of variables is enough and the whole table never needs to
exist.

## Reference solution

```ts
export function countWays(n: number): number {
  let previous = 1   // ways(1)
  let current = 1    // ways(0), the empty sequence — see below
  for (let step = 2; step <= n; step++) {
    const next = previous + current
    previous = current
    current = next
  }
  return current
}
```

The initialisation is the only place this goes wrong. Seeding `previous = 0`
gives plain Fibonacci and is off by one everywhere — `countWays(2)` returns 1
instead of 2, which is the first thing the suite checks.

## Cost

Time O(n), space O(1). The naive recursion is O(1.6ⁿ) time and O(n) stack.
Memoised recursion is O(n) time and O(n) space — correct, and worth naming as the
intermediate step, but the rolling pair is strictly better and no harder to
write.

## What the suite was testing

A scale test at `n = 77`, where the naive recursion needs on the order of 10¹⁶
calls and does not finish today. 77 is not arbitrary: the answer at `n = 78`
exceeds `Number.MAX_SAFE_INTEGER`, so 77 is the largest input where the expected
value is exactly representable and the assertion is testing arithmetic rather
than floating-point drift.

The expected value is a literal in the test rather than a loop, deliberately —
computing it with a loop would be re-implementing the reference inside its own
test, which proves nothing.

## The tell

**"How many ways" or "the best way", where a choice at each step leads to a
smaller version of the same question.** The move is always the same: ask what the
last decision was, and let it partition the answers into disjoint cases. Then ask
whether you need the whole table or only the last few rows — a 1-D recurrence
that reaches back `k` steps needs `k` variables, not an array.
