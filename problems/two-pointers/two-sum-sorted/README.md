# Two Sum (Sorted)

You are given an array `numbers` sorted in non-decreasing order, and a
`target`. Find the two **different** positions whose values add up to
`target`.

Return them as `[i, j]` with `i < j`, or `null` if no such pair exists.

## Constraints

- `2 <= numbers.length <= 500000`
- `-10^9 <= numbers[i] <= 10^9`
- `numbers` is sorted in non-decreasing order and may contain repeats
- At most one pair adds up to `target`
- A solution that checks every pair of positions will be rejected by this
  problem's test suite, even when it returns the correct answer.

## Examples

```
numbers = [2,7,11,15], target = 9
-> [0,1]

numbers = [1,2,3,4,4,9], target = 8
-> [3,4]        (4 + 4)

numbers = [1,2,3], target = 7
-> null
```

## Signature

```ts
export function twoSum(numbers: number[], target: number): [number, number] | null
```

## Run it

```bash
pnpm test two-sum-sorted     # attempt
pnpm reset two-sum-sorted    # start over from a clean stub
```
