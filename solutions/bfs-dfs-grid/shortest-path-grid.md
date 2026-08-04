# Shortest Path in a Binary Grid — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/bfs-dfs-grid/shortest-path-grid/` or given up on it for the session.

## The observation

This is "fewest steps to reach a target" in an unweighted graph — every move
costs exactly the same (one cell), so the first time any search reaches a
given cell, it has necessarily reached it by the fewest possible moves. A
breadth-first frontier that expands one full ring of distance at a time
preserves that guarantee automatically: everything at frontier distance `d`
is found before anything at distance `d + 1` is even looked at.

The classic bug is marking a cell visited **when it's dequeued** instead of
**when it's enqueued**. If you wait until dequeue, the same cell can be
pushed onto the queue many times (once for every neighbor that reaches it
before it's processed), and the queue balloons with duplicate work — in the
worst case this degrades toward the cost of the brute-force approach instead
of staying linear in the grid size. Marking on enqueue means each cell is
pushed at most once, full stop.

Depth-first search finds *a* path, not the *shortest* one — it commits to one
neighbor and walks as far as it can before backtracking, so the first path it
finds to the target can be arbitrarily longer than optimal. Nothing about DFS
tracks "distance so far" in a way that's comparable across branches the way a
breadth-first frontier does.

## Reference solution

```ts
export function shortestClearPath(grid: number[][]): number {
  const n = grid.length
  if (n === 0 || grid[0]!.length === 0) return -1
  if (grid[0]![0] !== 0 || grid[n - 1]![n - 1] !== 0) return -1

  if (n === 1) return 1

  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ]

  const visited = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  visited[0]![0] = true

  let frontier: Array<[number, number]> = [[0, 0]]
  let dist = 1

  while (frontier.length > 0) {
    const next: Array<[number, number]> = []
    for (const [r, c] of frontier) {
      if (r === n - 1 && c === n - 1) return dist

      for (const [dr, dc] of DIRS) {
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue
        if (visited[nr]![nc] || grid[nr]![nc] !== 0) continue
        visited[nr]![nc] = true
        next.push([nr, nc])
      }
    }
    frontier = next
    dist++
  }

  return -1
}
```

(An equivalent, slightly more common shape uses a single FIFO queue instead
of rebuilding a `frontier` array per ring — either works, as long as visited
is marked on enqueue.)

## Complexity

- **Time:** `O(n^2)` — each of the `n^2` cells is enqueued at most once, and
  each enqueue does O(1) work times up to 8 neighbor checks.
- **Space:** `O(n^2)` for the visited grid and the queue/frontier.

## The 8-direction and cell-counting details

- All 8 neighbors are legal moves, not just the 4 orthogonal ones. Grids
  exist where the shortest path is impossible with only up/down/left/right
  movement, or is strictly longer than the diagonal-aware optimum — a
  4-directional BFS silently returns the wrong (or no) answer on those.
- The answer counts **cells**, not moves. A path with `k` moves visits
  `k + 1` cells. The starting cell counts even though zero moves were taken
  to reach it — that's why the return value seeds at `1`, not `0`, and why
  distance is tracked as "cells so far" rather than "moves so far."

## Why DFS gives *a* path but not the shortest

DFS explores one branch to exhaustion (or until it hits the target) before
trying the next. There's no mechanism forcing it to prefer a 3-cell path over
a 30-cell one it happens to find first — whichever branch order the recursion
happens to try first wins, regardless of length. To get the shortest path out
of DFS you'd need to explore *every* path and take the minimum, which is
exactly the exponential brute force this problem's scale test rejects.

## Sibling problems (same pattern)

- **Rotting Oranges / multi-source BFS**: same ring-by-ring expansion, but
  starting from many cells at once instead of one.
- **Word Ladder**: identical shape one level of abstraction up — the "grid"
  is the set of words, and "adjacent" means one letter apart.
- **Number of Islands**: same 2D traversal, but DFS (or BFS) is used for
  reachability/counting, not shortest distance — the pattern branches here on
  what question is being asked.
- **Walls and Gates**: multi-source BFS again, but every cell records its own
  distance instead of just detecting one target.

## The tell

"Fewest steps" or "shortest path" in an **unweighted** grid/graph is BFS,
full stop. The moment weights or costs-per-edge enter the picture, reach for
Dijkstra instead — but plain step-counting on a grid is always breadth-first.

## Interview notes

- Say "fewest steps in an unweighted grid means BFS" before writing anything.
  It signals you're not about to reach for DFS or Dijkstra by reflex.
- State out loud that visited must be marked on enqueue, not dequeue, and
  why — this is the single most common bug on this pattern and interviewers
  listen for it.
- Check both the start and end cells for being blocked before doing any
  traversal work — an easy edge case to forget under pressure.
- Don't forget the diagonal directions; miscounting the neighbor set (4 vs 8)
  is the second most common slip.
