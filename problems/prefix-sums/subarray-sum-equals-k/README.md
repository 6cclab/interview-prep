# Subarray Sum Equals K

You are given an array of integers `nums` (values may be **negative**) and an
integer `k`.

Return the number of contiguous subarrays whose elements sum to exactly `k`.

A subarray is a contiguous, non-empty run of `nums`. Two subarrays count
separately if they occupy different index ranges, even if their contents are
identical.

## Constraints

- `1 <= nums.length <= 250000`
- `-1000 <= nums[i] <= 1000`
- `-10^9 <= k <= 10^9`
- A solution that sums every subarray will be rejected by this problem's
  test suite, even if it returns the correct answer.

## Examples

```
nums = [1,1,1], k = 2
-> 2         ([1,1] at indices 0-1, and [1,1] at indices 1-2)

nums = [1,2,3], k = 3
-> 2         ([1,2] and [3])

nums = [1,-1,0], k = 0
-> 3         ([1,-1], [0], and [1,-1,0])
```

## Signature

```ts
export function subarraySum(nums: number[], k: number): number
```

## Run it

```bash
pnpm test subarray-sum-equals-k     # attempt
pnpm reset subarray-sum-equals-k    # start over from a clean stub
```
