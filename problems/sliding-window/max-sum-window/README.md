# Maximum Sum of a Fixed Window

Given an array `values` and a window size `k`, return the largest sum of any
`k` consecutive values.

If `k` is larger than the array, return `null` — there is no such window.

## Constraints

- `1 <= values.length <= 500000`
- `1 <= k <= 250000`
- `-10^6 <= values[i] <= 10^6`
- Values may be negative, so the answer is not always found by growing a window
- A solution that adds up each window from scratch will be rejected by this
  problem's test suite, even when it returns the correct answer.

## Examples

```
values = [1,4,2,10,2,3,1,0,20], k = 4
-> 24        (the last window: 3+1+0+20)

values = [-3,-1,-4,-2], k = 2
-> -4        (-3+-1; every window is negative, so the answer is too)

values = [5], k = 3
-> null
```

## Signature

```ts
export function maxWindowSum(values: number[], k: number): number | null
```

## Run it

```bash
pnpm test max-sum-window     # attempt
pnpm reset max-sum-window    # start over from a clean stub
```
