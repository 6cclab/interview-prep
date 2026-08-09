# Maximum Sum of a Fixed Window — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

Consecutive windows overlap in `k - 1` values. Recomputing the sum from scratch
re-adds all of them, which is where the `n·k` comes from. Sliding one position
right adds exactly one value and drops exactly one:

```
sum(i + 1) = sum(i) + values[i + k] - values[i]
```

so each step is two arithmetic operations regardless of how wide the window is.
Seed the sum with the first window, then slide, keeping the best you have seen.

The general principle is that a window's *state* can be maintained incrementally
rather than recomputed — for a sum it is exact and reversible, which is what
makes fixed-window sums the easy case. Maintaining a *maximum* under the same
sliding is much harder, because removing a value cannot be undone by arithmetic;
that is what the monotonic-deque variant exists for.

## Reference solution

```ts
export function maxWindowSum(values: number[], k: number): number | null {
  if (k > values.length) return null
  let sum = 0
  for (let i = 0; i < k; i++) sum += values[i]!
  let best = sum
  for (let i = k; i < values.length; i++) {
    sum += values[i]! - values[i - k]!
    if (sum > best) best = sum
  }
  return best
}
```

`let best = sum` and not `let best = 0`. Seeding the running maximum at zero
silently assumes the answer is non-negative, and the suite has an all-negative
fixture for exactly that reason: `maxWindowSum([-3, -1, -4, -2], 2)` is `-4`, not
`0`.

## Cost

Time O(n), space O(1). The from-scratch version is O(n·k) time.

## What the suite was testing

A scale test at n = 200,000 with k = 50,000 — 10¹⁰ additions for the
from-scratch version, against one addition and one subtraction per position for
the rolling sum.

The answer is known by construction: background values are 0..4 and a run of
exactly `k` values of 10⁶ is planted at a fixed offset, so any window not
covering the whole plateau trades at least one 10⁶ for at most a 4 and the
plateau window is the unique maximum. The same fixture is then queried with
`k = 2` and `k = k + 1` — cheap for either approach, so those two assert answers
rather than the clock, and they catch a window that is off by one.

## The tell

**A fixed-size window, or "contiguous subarray" with a constraint that is
monotone as the window grows.** Fixed `k` is the easy signal. The harder cousin
is a *variable* window — "longest subarray with at most K distinct" — where you
grow the right edge greedily and only pull the left edge in when the constraint
breaks. Both are the same idea: never recompute what the previous window already
told you.
