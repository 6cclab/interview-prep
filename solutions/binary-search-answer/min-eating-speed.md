# Minimum Eating Speed — worked solution

> Spoiler. `prompts/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

The search space isn't the array — it's the answer. Speed `k` can be any
integer from `1` to `max(piles)` (at `max(piles)` a single pile takes exactly
one hour, and no pile can ever need more than that), and feasibility is
**monotone** in `k`: if speed `k` finishes within `h` hours, every speed above
`k` also finishes within `h` hours, because a faster speed never increases the
hours spent on any pile. That monotonicity is what makes binary search valid
here — there's no array to search, but there's a predicate over integers that
flips exactly once from "infeasible" to "feasible" as `k` increases, and
binary search finds that flip point in `O(log(max pile))` checks instead of
walking every candidate from `1` upward.

The predicate itself, `canFinish(k)`, is: sum over all piles of
`ceil(pile / k)` hours, and check whether that total is `<= h`.

## Reference solution

```ts
export function minEatingSpeed(piles: number[], h: number): number {
  function hoursNeeded(k: number): number {
    let hours = 0
    for (let i = 0; i < piles.length; i++) {
      hours += Math.ceil(piles[i]! / k)
    }
    return hours
  }

  let lo = 1
  let hi = Math.max(...piles)
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (hoursNeeded(mid) <= h) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }
  return lo
}
```

This is the standard "find the leftmost feasible value" binary search: `hi`
only ever moves down to a value that's already known feasible, `lo` only ever
moves up past a value that's known infeasible, and the loop stops once they
meet — at which point `lo` (== `hi`) is the smallest feasible speed.

## Complexity

`O(n log(max(piles)))` time, where `n` is the number of piles: each of the
`O(log(max(piles)))` binary search steps does one `O(n)` feasibility check.
`O(1)` extra space.

## Why the bounds are 1 and max(piles)

- `1` is the slowest speed that still makes progress (speed `0` never
  finishes anything).
- `max(piles)` always works: at that speed every pile finishes in exactly one
  hour, so the total is `piles.length` hours, and the problem guarantees
  `h >= piles.length`. There's never a reason to search above `max(piles)` —
  nothing beyond it could ever be a tighter answer.

## The ceil-division detail

Each pile takes `ceil(pile / k)` hours, not `floor(pile / k)`, because Koko
can't carry leftover eating capacity into another pile within the same hour —
a partial pile still consumes a whole hour. Flooring instead of ceiling
under-counts hours whenever a pile doesn't divide evenly by `k`, which makes
infeasible speeds look feasible and returns an answer that's too small. The
drill's `[10]`-pile test (`h = 3` needs speed `4`, not `3`) exists specifically
to catch that mistake: `floor(10/3) = 3 <= 3` looks fine, but `ceil(10/3) = 4`
correctly reveals that speed `3` isn't actually enough.

## Sibling problems in this pattern

- Capacity To Ship Packages Within `D` Days — same shape, feasibility is "can
  the packages ship in `D` days at capacity `k`", search space is
  `[max(weights), sum(weights)]`.
- Split Array Largest Sum — minimize the largest subarray sum under a fixed
  number of splits; feasibility is "can you split into `<= m` parts with each
  part `<= k`".
- Magnetic Force Between Two Balls — maximize the minimum gap; feasibility
  flips the other direction (larger gap is *harder*, not easier), so the
  search finds the rightmost feasible value instead of the leftmost.

## The tell

Whenever a problem asks for a minimum (or maximum) numeric value — a speed,
capacity, distance, or budget — subject to some yes/no feasibility check that
gets easier (or harder) monotonically as the value increases, that's the
signal. The array or constraint list in the problem is what the feasibility
check consumes, not what you search over.

## Interview notes

- Say the observation out loud before writing code: "feasibility is monotone
  in k, so I can binary search the answer instead of scanning it." That
  sentence is most of the signal an interviewer is listening for.
- State the bounds and justify them (`1` and `max(piles)`) before touching the
  loop — a wrong or unjustified bound is a common self-inflicted bug here.
- Get the leftmost-feasible binary search template exactly right:
  `hi = mid` on feasible, `lo = mid + 1` on infeasible, loop while `lo < hi`.
  Mixing up `<=`/`<` or forgetting the `+1` is the most common slip, and it's
  worth writing the invariant down explicitly ("lo is the smallest value not
  yet proven infeasible... no — hi is always feasible or the initial bound,
  lo is always either infeasible or the initial bound") rather than trusting
  memory under pressure.
- Watch for integer overflow / precision in the feasibility check when pile
  sizes are large — this problem's numbers stay well under
  `Number.MAX_SAFE_INTEGER` (2^53), so plain JS numbers are fine, but it's
  worth naming that constraint rather than reaching for `BigInt` out of
  habit.
