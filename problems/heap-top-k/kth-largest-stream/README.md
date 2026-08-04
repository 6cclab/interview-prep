# Kth Largest Element in a Stream

Design a class that tracks the k-th largest value across a stream of
numbers.

The class is constructed with an integer `k` and an initial array `nums` of
values already seen. After that, values arrive one at a time through `add`.
Every value that arrives — from the initial array or from `add` — stays part
of the set that's been seen; nothing is ever removed, and duplicate values
are kept as separate entries rather than collapsed into one. Each call to
`add` must report the k-th largest value seen so far, counting duplicates.
For example, if the values seen so far are `[5, 5, 5]` and `k = 2`, the
answer is `5` — the second-largest entry, not the second-largest *distinct*
value.

If fewer than `k` values have been seen in total (initial values plus adds
so far) at the time `add` is called, `add` returns the smallest value seen
so far instead.

JavaScript's standard library has no built-in container that keeps itself
ordered as you insert into it and lets you read off a value by rank at low
cost — if your approach wants one, you'll need to build it yourself.

## Constraints

- `1 <= k <= 10^4`
- `0 <= nums.length <= 10^4`
- `-10^4 <= nums[i], val <= 10^4`
- `add` is called many times over the object's lifetime — potentially far
  more times than the length of the initial array.
- A solution that keeps the full history and re-sorts it on every `add` call
  will be rejected by this problem's test suite, even when it returns the
  correct answer every time.

## Examples

```
k = 3, nums = [4, 5, 8, 2]
add(3)  -> 4
add(5)  -> 5
add(10) -> 5
add(9)  -> 8
add(4)  -> 8
```

```
k = 1, nums = [3]
add(5)  -> 5
add(2)  -> 5
add(10) -> 10
```

```
k = 4, nums = []
add(1)  -> 1     // only 1 value seen so far (< k) -> smallest seen
add(9)  -> 1     // 2 values seen so far (< k) -> smallest seen
add(2)  -> 1     // 3 values seen so far (< k) -> smallest seen
add(6)  -> 1     // 4 values seen so far (== k) -> 4th largest, which is the min of all 4
add(20) -> 2     // 5 values seen: [20, 9, 6, 2, 1] -> 4th largest is 2
```

## Signature

```ts
export class KthLargest {
  constructor(k: number, nums: number[])
  add(val: number): number
}
```

## Run it

```bash
pnpm test kth-largest-stream     # attempt
pnpm reset kth-largest-stream    # start over from a clean stub
```
