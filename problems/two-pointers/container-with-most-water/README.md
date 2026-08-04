# Container With Most Water

You are given an array `heights` of non-negative integers. `heights[i]` is the
height of a vertical line drawn at index `i`. Together with the x-axis, any
two of these lines form a container.

Find the two lines that form the container holding the most water, and return
how much water it holds. The container formed by indices `i` and `j` holds:

```
min(heights[i], heights[j]) * (j - i)
```

Water is measured as this area, not a physical volume — the lines have no
thickness, and width is index distance.

## Constraints

- `2 <= heights.length <= 200000`
- `0 <= heights[i] <= 10^9`
- A solution that checks every pair of lines will be rejected by this
  problem's test suite, even when it returns the correct answer.

## Examples

```
heights = [1,8,6,2,5,4,8,3,7]
-> 49        (lines at index 1 and 8: min(8,7) * (8-1) = 7 * 7 = 49)

heights = [1,1]
-> 1

heights = [4,3,2,1,4]
-> 16        (lines at index 0 and 4: min(4,4) * (4-0) = 4 * 4 = 16)
```

## Signature

```ts
export function maxArea(heights: number[]): number
```

## Run it

```bash
pnpm test container-with-most-water     # attempt
pnpm reset container-with-most-water    # start over from a clean stub
```
