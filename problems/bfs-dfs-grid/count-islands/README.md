# Number of Islands

You are given an `m x n` grid where each cell is either `'1'` (land) or `'0'`
(water). Return the number of **islands** in it.

An island is a group of land cells connected to each other **horizontally or
vertically**. Two land cells touching only at a corner are *not* connected and
belong to different islands.

You may assume every cell outside the grid is water, so the grid's edges need
no special handling.

## Constraints

- `1 <= m, n <= 1000`
- Every cell is the string `'1'` or the string `'0'`
- The input grid may be modified in place if you want to — nothing reads it
  afterwards. If you would rather not, that is fine too; the suite does not
  check either way.
- A solution that re-examines the whole grid once per island will be rejected
  by this problem's test suite, even though it returns the correct answer.
  Getting the count right is not enough.

## Examples

```
[['1','1','1','1','0'],
 ['1','1','0','1','0'],
 ['1','1','0','0','0'],
 ['0','0','0','0','0']]
-> 1         all the land is one connected mass

[['1','1','0','0','0'],
 ['1','1','0','0','0'],
 ['0','0','1','0','0'],
 ['0','0','0','1','1']]
-> 3         the 2x2 block, the lone cell at (2,2), and the pair at the
             bottom right. Note that (1,1) and (2,2) touch diagonally and
             are still counted separately.

[['0','0'],
 ['0','0']]
-> 0         no land at all

[['1']]
-> 1
```

## Signature

```ts
export function countIslands(grid: string[][]): number
```

## Run it

```bash
pnpm test count-islands     # attempt
pnpm reset count-islands    # start over from a clean stub
```
