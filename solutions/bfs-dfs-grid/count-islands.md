# Number of Islands — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/bfs-dfs-grid/count-islands/` or given up on it for the session.

## The observation

The question asks for a count of connected components, and the whole problem
turns on one reframing: **you are not searching for islands, you are scanning
cells and occasionally starting a search.**

Walk the grid in reading order. Almost every cell you touch is either water, or
land you have already absorbed into an island you counted earlier. The only
interesting case is land you have never seen before — and that cell, by
definition, cannot belong to any island counted so far, because if it did, the
earlier search would have reached it. So it starts a new island: increment the
counter once, then exhaustively visit everything reachable from it and mark all
of it seen.

That marking is what makes the outer scan cheap. After the search returns, every
cell of that landmass is seen, so none of them can trigger a second increment no
matter how many of them the outer loop walks over afterwards.

Whether the exhaustive visit is depth-first (recursion or an explicit stack) or
breadth-first (a queue) makes no difference at all here. There is no notion of
distance in this problem — nothing is being minimised — so the two orders visit
exactly the same set of cells and cost exactly the same. Pick whichever you
write more fluently. This is worth saying out loud in an interview: recognising
that the choice is free is a stronger signal than picking one and defending it.

## Where it goes quadratic

The cost trap this problem's suite is built around is not a brute force. It is
**per-island bookkeeping**:

```ts
// WRONG — correct answers, quadratic cost
for (each cell) {
  if (isLand(cell) && !visited[cell]) {
    const visited = new Array(m * n).fill(false)   // <-- allocated per island
    flood(cell, visited)
    count++
  }
}
```

Every island pays O(m·n) for a structure it uses a handful of cells of. With
one big island that is invisible. With 80,000 tiny ones — the checkerboard in
the scale test, where four-directional connectivity means no two land cells ever
touch — it is 80,000 × 160,000 operations, and the measured gap is ~8ms against
~11 seconds.

The fix is to hoist the visited structure out of the loop. One structure, created
once, shared by every search. That is the difference between O(m·n) and
O(islands × m·n).

The same bug wears a second disguise: clearing and reusing a shared array per
island (`visited.fill(false)`) instead of allocating a new one. It looks thriftier
and costs exactly the same.

## The other classic bug

Marking a cell seen **when you pop it** rather than **when you push it**. If you
wait until it comes off the stack or queue, the same cell can be pushed once by
every neighbour that reaches it first, and the frontier fills with duplicates. On
a dense landmass this degrades badly. Mark on push, and each cell enters the
frontier at most once.

If you sink the land instead — overwriting each visited `'1'` with `'0'` — you get
that property for free, because the cell stops looking like land the instant you
touch it, and you need no separate visited structure at all. That is why the
prompt says the grid may be modified in place. It is the tidiest version, but say
out loud that you are destroying the input, because in real code that is a
question for the caller, not a decision for the function.

## Reference solution

```ts
export function countIslands(grid: string[][]): number {
  const rows = grid.length
  if (rows === 0) return 0
  const cols = grid[0]!.length
  if (cols === 0) return 0

  let count = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r]![c] !== '1') continue

      // Unseen land: exactly one new island.
      count++

      // Explicit stack rather than recursion — a single landmass can span the
      // whole grid, and 1000x1000 is a million frames deep.
      const stack: Array<[number, number]> = [[r, c]]
      grid[r]![c] = '0' // marked on push, not on pop

      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!
        const neighbours: Array<[number, number]> = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ]
        for (const [nr, nc] of neighbours) {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
          if (grid[nr]![nc] !== '1') continue
          grid[nr]![nc] = '0'
          stack.push([nr, nc])
        }
      }
    }
  }

  return count
}
```

Only the four orthogonal neighbours are listed. Adding the diagonals is a
one-line change that silently merges corner-touching islands — which is why the
suite has a two-cell fixture testing exactly that.

## Cost

**Time O(m·n).** Each cell is examined by the outer scan once, and pushed onto
the frontier at most once across the entire run — not once per island. The
number of islands does not appear in the bound, which is the entire point.

**Space O(m·n) worst case.** The sinking version needs no visited structure, but
the frontier itself can still hold a constant fraction of the grid when the land
is one dense mass. If you keep a separate visited array, that is another O(m·n)
and does not change the bound.

## Saying it well

When you state the complexity, say **why** it is O(m·n) rather than
O(islands × m·n) — that the visited marks are shared across the whole scan. That
sentence is the difference between having written the fast version and knowing
you wrote the fast version, and it is the thing an interviewer is listening for
when they ask about Big-O.
