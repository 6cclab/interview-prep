# Shortest Path in a Binary Grid

You are given an `n x n` grid `grid` where every cell is `0` (clear) or `1`
(blocked). Starting at the top-left cell `(0, 0)` and ending at the
bottom-right cell `(n - 1, n - 1)`, find the length of the shortest **clear
path** between them.

A clear path only ever visits cells with value `0` (both the start and end
cells must be `0`), and consecutive cells in the path must be adjacent —
**including diagonally**. From any cell you may step to any of its up to
**8 neighbors**: up, down, left, right, and all four diagonals.

The length of a path is the number of **cells** it visits, counting both the
start and end cell. A path that never moves (a `1x1` grid whose only cell is
clear) has length `1`, not `0`.

Return `-1` if no clear path exists.

## Constraints

- `1 <= n <= 1000`
- `grid[i][j]` is `0` or `1`
- A brute-force solution that enumerates candidate paths will be rejected
  by this problem's test suite, even when it returns the correct answer —
  and so will one that finds *a* path without finding the *shortest* one.

## Examples

```
grid = [[0,1],
        [1,0]]
-> 2         (0,0) and (1,1) are diagonal neighbors, so the path is
             [(0,0), (1,1)] — two cells, one diagonal move. Note that this
             path is NOT length 1: length counts cells visited, not moves
             taken.

grid = [[0,0,0],
        [1,1,0],
        [1,1,0]]
-> 4         e.g. (0,0) -> (0,1) -> (1,2) -> (2,2)

grid = [[1,0],
        [0,0]]
-> -1        the start cell is blocked

grid = [[0]]
-> 1         a single clear cell is a path of length 1 all by itself
```

## Signature

```ts
export function shortestClearPath(grid: number[][]): number
```

## Run it

```bash
pnpm test shortest-path-grid     # attempt
pnpm reset shortest-path-grid    # start over from a clean stub
```
