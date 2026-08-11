# Move Zeroes — worked solution

## The tell

Partition an array in place while **preserving relative order**. The order
requirement is the whole difficulty: without it, swapping each zero with the last
unprocessed element would do.

## The observation

Two cursors moving in the same direction, at different speeds: a read cursor that
visits every element, and a write cursor that only advances when something is
written. Copy every non-zero value to the write position, then fill everything
from the write cursor to the end with zeros.

The write cursor lags the read cursor by exactly the number of zeros seen so far,
which is why nothing gets overwritten before it is read.

The tempting wrong answer is swapping each zero with `nums[n - 1]`, or with the
last non-zero. It moves the zeros correctly and scrambles the non-zeros, so it
passes a test whose expected output happens to be sorted and fails
`[1,0,2,0,3,0,4]`.

## Reference solution

```ts
export function moveZeroes(nums: number[]): void {
  let write = 0
  for (let read = 0; read < nums.length; read += 1) {
    if (nums[read] !== 0) {
      nums[write] = nums[read]!
      write += 1
    }
  }
  for (let i = write; i < nums.length; i += 1) {
    nums[i] = 0
  }
}
```

A one-pass variant swaps `nums[read]` and `nums[write]` instead of copying, which
avoids the second loop. It is the same asymptotic cost and slightly easier to get
wrong; the two-loop version is the one to reach for under pressure.

## Cost

Time O(n) — every element is read once and written at most once. Space O(1).
