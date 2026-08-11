# Move Zeroes

Given an array of numbers, move every `0` to the end of the array while keeping
the **relative order of the non-zero values unchanged**. Do it in place and
return nothing.

## Constraints

- `0 <= nums.length <= 100000`
- Values may be negative
- The non-zero values must stay in the order they appeared
- You must modify the input array itself; the return value is ignored
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
[0,1,0,3,12]   ->  [1,3,12,0,0]
[0,0,1]        ->  [1,0,0]
[1,2,3]        ->  [1,2,3]
[0]            ->  [0]
```

## Signature

```ts
export function moveZeroes(nums: number[]): void
```

## Run it

```bash
pnpm test move-zeroes     # attempt
pnpm reset move-zeroes    # start over from a clean stub
```
