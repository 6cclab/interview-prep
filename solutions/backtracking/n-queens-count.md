# N-Queens — Count — worked solution

**Spoilers.** See `rules/no-spoilers.md`.

## The observation

Because no two queens can ever share a row, the "one queen per row" decision
is forced from the start: any valid placement has exactly one queen in row
`0`, one in row `1`, ..., one in row `n - 1`. That collapses the search from
"choose `n` cells out of `n^2`" down to "choose one column for each row" —
row conflicts are handled automatically just by framing the problem this
way, and all that's left to check is column and diagonal conflicts between
the queen being placed and every queen already placed in an earlier row.

The move that actually makes this fast is *when* that check happens. Build
the placement one row at a time, and the moment a candidate column conflicts
with an already-placed queen, stop — don't finish placing the rest of the
board first. Every row left unplaced below a bad choice is an entire subtree
of candidates that can never produce a valid board, and none of them are
ever visited. Compare that to building every full placement first and
validating only once it's complete: that approach still visits every one of
those doomed subtrees in full before finding out they were doomed. The
counting logic (increment a counter when a full valid placement is reached)
is identical either way — the entire speed difference comes from abandoning
a branch early instead of late.

## Reference solution

```ts
export function countNQueens(n: number): number {
  const cols = new Set<number>()
  const diag1 = new Set<number>() // keyed by row - col
  const diag2 = new Set<number>() // keyed by row + col
  let count = 0

  function place(row: number): void {
    if (row === n) {
      count++
      return
    }
    for (let col = 0; col < n; col++) {
      const d1 = row - col
      const d2 = row + col
      if (cols.has(col) || diag1.has(d1) || diag2.has(d2)) continue

      cols.add(col)
      diag1.add(d1)
      diag2.add(d2)
      place(row + 1)
      cols.delete(col)
      diag1.delete(d1)
      diag2.delete(d2)
    }
  }

  place(0)
  return count
}
```

## The O(1) conflict check

Three sets track everything a queen already on the board could attack, and
checking a candidate `(row, col)` against all of them is O(1) per set
instead of O(number of queens placed so far):

- `cols` — literally the set of occupied columns. Two queens share a column
  iff their `col` values are equal, so membership in `cols` is the whole
  check.
- `diag1`, keyed by `row - col` — every cell on the same "`\`"-diagonal
  (top-left to bottom-right) shares the same value of `row - col`. Walk
  down-right from any cell: both `row` and `col` increase by 1 each step, so
  their difference never changes. That's the invariant that makes `row -
  col` a valid diagonal id.
- `diag2`, keyed by `row + col` — every cell on the same "`/`"-diagonal
  (bottom-left to top-right) shares the same value of `row + col`, by the
  mirror argument: walking down-left, `row` increases and `col` decreases by
  1 each step, so their sum never changes.

Both diagonal directions are needed because a queen attacks along *both*;
using only one would miss half of the diagonal attacks. Adding a queen's
`col`, `row - col`, and `row + col` to the three sets when it's placed, and
removing them when the search backs out of that choice, is what keeps every
future check at this row and below O(1) instead of re-scanning the queens
already on the board.

## Complexity

Each of the `n` rows tries up to `n` columns, and the conflict check at each
try is O(1) thanks to the three sets, so the work done *at* any single node
of the search is O(n) per row, O(n^2) total per row across the board in the
worst case — cheap. What's expensive, and what has no closed form, is how
many nodes the search actually visits: that depends on how aggressively
invalid branches get cut off, which depends on the specific geometry of
conflicts at each `n`, which is exactly the quantity the "number of n-queens
solutions" sequence encodes and does not admit a formula for. In practice,
the three-set check prunes hard enough that the search stays fast through
the sizes this drill exercises, even though the raw candidate space (`n^n`
if row conflicts weren't already free, or `n!` even accounting for them) is
never remotely enumerated.

## Sibling problems

The same shape — place one item at a time, check only the O(1)-representable
constraints implied by items already placed, and give up on a partial
placement immediately rather than after completing it — shows up in:

- **N-Queens (return the boards, not just the count):** identical search;
  instead of incrementing a counter at `row === n`, snapshot the current
  `col` choice per row into a board and push it onto a results array.
- **Sudoku solver:** one cell at a time instead of one row; the "already
  placed" constraints are row/column/box membership instead of
  row/column/diagonal, but the early-abandon idea is the same.
- **Permutations with a constraint** (e.g. no element within `k` of its
  original index): build the permutation position by position and skip a
  candidate the moment it violates the constraint, rather than generating
  every permutation and filtering afterward.

## The tell

Whenever a problem asks you to build up a candidate — a placement, a
permutation, a subset, a path — and a *partial* candidate can already be
proven invalid before it's finished, that's the signal to check as you go
and walk away from a doomed partial candidate immediately, rather than
generating something complete and validating it at the end. The bigger the
gap between "how early a violation can be detected" and "how late a
generate-then-filter approach would detect it," the bigger the win.

## Interview notes

- Say out loud, before coding, that placing one queen per row makes row
  conflicts free — it's a small observation but it's the one that turns a
  2D placement problem into a 1D one, and skipping it makes the rest of the
  explanation harder to follow.
- Naming the two diagonal invariants (`row - col`, `row + col`) and *why*
  each is constant along its diagonal is worth doing explicitly — it's easy
  to get right by trial and error but much stronger to derive.
- If asked to return the actual boards instead of just a count, be ready to
  note that the only change is what happens at `row === n` — the search
  itself doesn't change, which is a good way to show the search and the
  "what do I do with a valid result" logic are cleanly separated.
- If asked about scaling `n` well beyond this drill's range, the honest
  answer is that even the pruned search is still worst-case exponential —
  there's no known polynomial algorithm for exact counts, and real
  large-`n` work (this problem has been solved for `n` past 25) relies on
  much heavier techniques (e.g. exploiting board symmetry to search only
  1/8th of it, or parallelizing across machines) layered on top of the same
  early-abandon idea, not a fundamentally different one.
