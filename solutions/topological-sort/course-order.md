# Course Order — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/topological-sort/course-order/` or given up on it for the session.

## The observation

Every course has some number of prerequisites it's still waiting on. Track
that count per course — call it its unmet-prerequisite count. A course
becomes takeable the moment that count hits zero, and it can only ever hit
zero once, when its last remaining prerequisite gets taken.

So: seed a queue with every course whose count is already zero (no
prerequisites at all). Pop a course from the queue, add it to the order, and
for every course that lists it as a prerequisite, decrement that course's
count. Any course whose count just dropped to zero goes into the queue. Repeat
until the queue is empty.

Each edge `(b before a)` is examined exactly once — when `b` is popped, it
decrements `a`'s count once and never touches it again. That's what keeps this
linear instead of repeatedly rescanning the whole course list looking for the
next taker.

If the queue empties out before every course has been added to the order,
whatever's left can never reach a count of zero — every course still waiting
has at least one prerequisite that's also still waiting, which is only
possible if they're waiting on each other. That's a cycle, and it's the only
way to end up short: return an empty array.

## Reference solution

```ts
export function findOrder(
  numCourses: number,
  prerequisites: number[][],
): number[] {
  const indegree = new Array<number>(numCourses).fill(0)
  const dependents: number[][] = Array.from({ length: numCourses }, () => [])

  for (const pair of prerequisites) {
    const a = pair[0]!
    const b = pair[1]!
    dependents[b]!.push(a)
    indegree[a]!++
  }

  const queue: number[] = []
  for (let course = 0; course < numCourses; course++) {
    if (indegree[course] === 0) queue.push(course)
  }

  const order: number[] = []
  let head = 0
  while (head < queue.length) {
    const course = queue[head++]!
    order.push(course)
    for (const next of dependents[course]!) {
      indegree[next]!--
      if (indegree[next] === 0) queue.push(next)
    }
  }

  return order.length === numCourses ? order : []
}
```

Using `queue` itself as a growable array with a `head` pointer (instead of
`Array.prototype.shift()`, which is O(n) per call) keeps the whole pass
linear.

## Complexity

- Time: `O(V + E)` — every course is enqueued and dequeued at most once, and
  every prerequisite edge is walked exactly once, when its "before" course is
  popped.
- Space: `O(V + E)` for the adjacency lists, the count array, and the queue.

## Why a short result proves a cycle

A course only enters the queue when its count reaches zero, and the count
only reaches zero when every one of its prerequisites has already been
popped and added to `order`. So nothing enters `order` before all of its
prerequisites do — the output is a valid order by construction whenever the
loop processes all `numCourses` courses.

If it stops early, the unprocessed courses form a subgraph where every node
still has at least one unprocessed prerequisite (otherwise its count would
have hit zero and it would have been enqueued). A finite set where every
member points to another member that's also stuck is exactly a cycle — you
can't have a subgraph where everybody is still waiting on somebody unless
some of that waiting loops back on itself. There's no other way to get stuck.

## The DFS-with-colours alternative

Instead of counting down prerequisites, do a DFS from each unvisited course,
colouring nodes white (unvisited) / grey (on the current recursion stack) /
black (fully processed and safe). Hitting a grey node while descending means
the recursion looped back on something it's still in the middle of — a cycle.
A node gets prepended to the output the moment it's fully explored (all its
prerequisites, transitively, are already black), which naturally produces a
valid order in reverse.

Same `O(V + E)` complexity either way. The queue-based version tends to be
easier to reason about and to avoid recursion-depth issues on a long chain
(a chain of 100,000 courses is a genuine risk for a recursive call stack);
the DFS version is sometimes preferred when the interviewer wants to see
explicit cycle *detection* as a distinct, named step rather than something
that falls out implicitly from "the queue ran dry early."

## Sibling problems (same pattern)

- **Course Schedule** (the yes/no variant): same algorithm, just check
  whether the output length equals `numCourses` instead of returning the
  order itself.
- **Alien Dictionary**: build the edges by comparing adjacent words
  character-by-character to infer ordering constraints, then run the same
  queue-based process on the resulting graph.
- **Minimum Height Trees**: not the same goal, but the same "peel off nodes
  with count 1 (a leaf), repeat" queue-draining shape.
- **Parallel Courses / minimum semesters**: same graph, but track the queue's
  processing in *levels* — each level is everything takeable simultaneously —
  and count levels instead of building a single flat order.

## The tell

An ordering (or a build/compile/install sequence) has to respect "this before
that" constraints between items, and you need either a valid order or proof
that no such order exists. Whenever the answer could stall out because
everything left is mutually waiting on everything else, that stall is the
cycle, and that's this pattern rather than a plain traversal.

## Interview notes

- Say out loud that a rescan-everyone-every-round approach works but is
  quadratic before you write the linear version — it's a legitimate first
  instinct and naming its cost is part of demonstrating you know why the
  count-based version is better.
- State the cycle argument explicitly: "if the queue runs dry before I've
  placed every course, whatever's left must be stuck waiting on each other."
  Interviewers often ask directly how you'd detect a cycle, and "the queue
  runs dry early" is the whole answer for this approach.
- A course that lists itself as a prerequisite is a self-loop, and it's a
  cycle with one node — the algorithm handles it automatically as long as the
  self-edge is counted like any other, no special case needed.
- Duplicate prerequisite pairs are easy to get wrong: if you increment a
  count once per duplicate pair without deduplicating, and also decrement it
  once per duplicate edge on the other side, the two duplications cancel out
  correctly. The bug shows up only if you deduplicate on one side and not the
  other.
