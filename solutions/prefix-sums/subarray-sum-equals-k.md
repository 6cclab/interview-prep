# Subarray Sum Equals K — worked solution

> Spoiler. `prompts/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Let `prefix[i]` be the sum of `nums[0..i)` (so `prefix[0] = 0`, the sum of an
empty prefix). The sum of the subarray `nums[i..j)` is `prefix[j] - prefix[i]`.

So "does some subarray ending at index `j-1` sum to `k`?" becomes: is there an
earlier prefix `prefix[i]` (`i <= j`) such that

```
prefix[j] - prefix[i] = k
  =>  prefix[i] = prefix[j] - k
```

Walk the array once, maintaining a running `sum` (the prefix total so far)
and a hashmap from *prefix value seen so far* to *how many times it's been
seen*. At each index, before recording the current prefix, look up
`sum - k` in the map — every hit is one subarray ending here that sums to
`k`. Then record `sum` itself in the map for future indices to consult.

This turns an O(n) check ("has any subarray ending here summed to k?") into
an O(1) map lookup, and the whole scan is O(n) instead of O(n^2).

## Reference solution

```ts
export function subarraySum(nums: number[], k: number): number {
  const counts = new Map<number, number>([[0, 1]])
  let sum = 0
  let total = 0

  for (const x of nums) {
    sum += x
    total += counts.get(sum - k) ?? 0
    counts.set(sum, (counts.get(sum) ?? 0) + 1)
  }

  return total
}
```

## Complexity

- Time: O(n) — one pass, O(1) map operations per element.
- Space: O(n) — the map can hold up to n+1 distinct prefix values.

## Why the map must be seeded with `{0: 1}`

Without seeding, a subarray that sums to `k` starting from index 0 is
invisible: at the index where `sum` first equals `k`, the lookup is for
`sum - k = 0`, but `0` (the empty prefix, i.e. "the subarray could start at
index 0") was never recorded. Seeding `counts` with `{0: 1}` treats the empty
prefix as having occurred once, before the loop starts, so subarrays
beginning at index 0 get counted like any other.

This is the same seam that trips up solvers on "subarray sums to a
multiple of k" and similar prefix problems — the seed represents "a
subarray can start at the very beginning," and it's easy to forget because
it doesn't correspond to any loop iteration.

## Why negatives break a sliding-window approach

Sliding-window (two pointers) relies on monotonicity: growing the window can
only increase the sum, so once the sum overshoots the target you know
shrinking from the left is the only useful move, and you never have to
reconsider a window you've already shrunk past. With negative values in the
array, growing the window can *decrease* the sum, so overshooting is no
longer a stable, one-directional signal — a window that looks wrong can
become right again by including more elements, and there's no monotone
quantity left to pivot on. Prefix sums plus a hashmap of *all* prefix values
seen so far sidesteps monotonicity entirely: it doesn't care whether the
running sum goes up or down, only whether a specific earlier value has been
seen.

## Sibling problems in this pattern

- Range sum queries with repeated static queries (precompute once, answer
  each query in O(1)).
- Subarray sum divisible by k / continuous subarray sum (same map, but keyed
  on `sum % k` instead of `sum` directly).
- Contiguous array with equal number of 0s and 1s (map 0 -> -1, 1 -> +1, then
  this is "subarray sum equals 0").

## The tell

"Number of contiguous subarrays/subranges summing to X" (not "find the max"
or "find one"), especially once the array can contain negative numbers,
which is a strong signal against sliding-window. "How many pairs/prefixes
satisfy some running relationship" is the shape to watch for — it usually
means: compute a running quantity once, then trade an O(n) inner check for
an O(1) hashmap lookup keyed on that running quantity.

## Interview notes

- State the observation (subarray sum = difference of two prefix sums)
  explicitly before writing code — it's the whole idea, and interviewers
  want to hear you find it, not just watch you write a hashmap loop.
- Say out loud why you're seeding the map with `{0: 1}` — it's the detail
  most likely to be the actual bug in a live coding attempt, and naming it
  proactively reads as understanding rather than luck.
- If asked to also return one such subarray (not just the count), store the
  *index* of the first (or last) occurrence of each prefix sum instead of a
  count — same map, different value type.
- If pressed on why not sliding-window: lead with the negative-number
  argument above, not "the problem says subarrays not windows" — the
  interviewer wants the monotonicity reasoning, not a restatement of the
  prompt.
