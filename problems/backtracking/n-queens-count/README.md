# N-Queens — Count

You are given a board size `n`. Place `n` queens on an `n x n` chessboard so
that no two queens attack each other, and return **how many distinct ways**
this can be done. You do not need to return or render the boards themselves
— only the count.

Two queens attack each other if they share:

- the same row, or
- the same column, or
- the same diagonal (either direction — a queen at `(r1, c1)` and one at
  `(r2, c2)` share a diagonal when `r1 - c1 === r2 - c2` or
  `r1 + c1 === r2 + c2`).

Two placements are distinct if any queen sits in a different cell between
them; rotations and reflections of a valid placement each count separately.

## Constraints

- `1 <= n <= 13`
- A placement is valid only if every pair of the `n` queens on the board is
  free of all three attack conditions above.
- A solution that first generates full placements of `n` queens (one per
  row, say) and only checks whether each finished placement is valid will be
  rejected by this problem's test suite, even when it returns the correct
  count.

## Examples

```
n = 1
-> 1        (a single queen never attacks itself)

n = 2
-> 0        (no way to place two queens on a 2x2 board without conflict)

n = 3
-> 0        (same story on a 3x3 board)

n = 4
-> 2

n = 8
-> 92
```

## Signature

```ts
export function countNQueens(n: number): number
```

## Run it

```bash
pnpm test n-queens-count     # attempt
pnpm reset n-queens-count    # start over from a clean stub
```
