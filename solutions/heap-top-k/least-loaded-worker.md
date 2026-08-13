# When Does the Last Job Finish — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/heap-top-k/least-loaded-worker/` or given up on it for the session.

**This is a reconstruction, not a CrowdStrike question.** See the Provenance
section on the problem's README. It exists to drill a data-structure decision,
not to predict a prompt.

## The observation

The problem describes workers, but you never need to model a worker. A worker
that has been assigned jobs is fully described by **one number: the time it
becomes free.** Its identity, its history, and which jobs it ran are all
irrelevant to the answer.

So the state is a multiset of free-at times, and the loop is:

1. Take the next job in queue order.
2. Pull out the smallest free-at time — that is the worker who can start soonest.
3. Its new free-at time is `start + duration`. Put that back.
4. Track the running maximum; that is the answer.

Repeatedly *remove the smallest* and *insert a replacement* is the operation a
min-heap exists for. Both are O(log w), so the whole thing is O(n log w).

The scheduling rule itself is not a decision you make — the problem states it.
This is worth noticing, because it means there is no optimization to reason
about, no exchange argument, no proof of greedy optimality. You are simulating a
stated policy. The only question is what structure makes the simulation cheap.

## Idle workers

Before every worker has a job, "the earliest a worker is free" is 0, and there
may be many such workers. Two ways to handle it:

- Seed the heap with `w` zeros up front. Simple, obviously correct, and costs
  O(w) time and space even when there are three jobs and a million workers.
- Keep an `idle` counter, spend from it first, and only touch the heap once the
  pool is saturated. The heap then never grows past `min(n, w)`.

```ts
const start = idle > 0 ? (idle--, 0) : busy.pop()
busy.push(start + duration)
```

The second is what the reference does, and the reason is the scale test: 100,000
workers against 400,000 jobs. Seeding is fine there too, but the counter version
is the one that stays sane when the pool dwarfs the queue, which is the
realistic shape for a thread pool.

Either way, note what you are *not* doing: a worker that has been assigned a job
goes into the heap and stays there. You never remove it when it "finishes." Time
never advances on its own in this simulation — it advances only when you assign
work.

## Where it goes quadratic

The cost trap is the direct translation of the English:

```ts
// WRONG — correct answers, quadratic cost
const free = new Array(workers).fill(0)
for (const duration of jobs) {
  let best = 0
  for (let i = 1; i < workers; i++) if (free[i] < free[best]) best = i   // <-- O(w)
  free[best] += duration
}
```

This is exactly right and reads better than the heap version. It is also O(n·w),
and at 400,000 jobs against 100,000 workers that is 4×10¹⁰ comparisons.
Measured: 24ms for the heap, 30 seconds for the scan.

The worker count is what separates them, not the job count. With eight workers
the scan is *faster* than a heap — eight comparisons beat three swaps plus the
allocation. This is the honest version of the trade-off and it is worth being
able to state: the heap wins when w is large, and at w in the single digits it
is the wrong call.

The suite's second scale test exists because of a subtler failure. With every
job the same duration, the pool stays perfectly balanced and "pick any worker"
also produces the right answer — so a solution with a broken selection rule can
pass on uniform input by accident. Varying the durations makes the choice
matter. (That test was originally sized so that even the linear scan passed it,
which made it useless as a cost gate; it is now sized to fail the scan too.)

## Edge cases and where they bite

- **No jobs.** Return 0. A loop that reads `heap[0]` before checking emptiness
  crashes; a solution that returns `-Infinity` from an unseeded maximum is worse
  because it looks like arithmetic.
- **A zero-duration job.** It still consumes a worker slot and still counts as a
  job — it just does not advance that worker's clock. Skipping it as "no work"
  changes which worker later jobs land on.
- **More workers than jobs.** Every job starts at 0, so the answer is the longest
  single job. Falls out for free.
- **Large durations.** Totals reach 10¹⁴ here, which is well inside JavaScript's
  exact-integer range, but any solution that advances a clock one tick at a time
  never returns. The suite has a fixture that fails in under a second for a heap
  and never finishes for a tick loop.

## What an interviewer is listening for

- Reducing a worker to a single number, out loud, before writing code. That
  reduction is the whole insight; everything after it is bookkeeping.
- Reaching for the ordered structure because of the *access pattern* — smallest,
  repeatedly, with replacement — rather than because heaps are a topic.
- Naming the O(n·w) version, saying why it is correct, and then saying why it is
  rejected. Skipping straight to the heap without acknowledging the simple
  version reads as pattern-matching.
- Knowing when the scan is the right answer. "With w small I'd just scan" is a
  senior thing to say and interviewers notice it.
- O(n log w) time, O(min(n, w)) space.

## Complexity

- **Time** — O(n log w). Each job costs one pop and one push.
- **Space** — O(min(n, w)) with the idle counter; O(w) if you seed the heap.
