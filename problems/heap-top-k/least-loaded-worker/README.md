# When Does the Last Job Finish

A pool of identical workers processes a queue of jobs. Jobs are taken **in the
order given**. When a job is taken it goes to whichever worker will be free
soonest; if several are free at the same moment, any of them will do. A worker
runs one job at a time, start to finish, with no preemption.

Everything starts at time zero. Return the time at which the **last** job
finishes.

## Details that are easy to get wrong

- **Jobs are not reordered.** This is a queue, not a packing problem. Sorting
  the durations changes the answer and solves a different question.
- **More workers than jobs is normal.** Then every job starts at 0 and the
  answer is just the longest one.
- **A duration may be 0.** Such a job occupies a worker for no time at all.
- Durations can be large, and so can their total — large enough that advancing
  a clock one tick at a time is not viable.

## Constraints

- `0 <= jobs.length <= 400000`
- `1 <= workers <= 100000`
- `0 <= jobs[i] <= 10^9`
- A solution that scans every worker to find the earliest-free one for each job
  is correct, and will be rejected by this problem's test suite on cost.

## Examples

```
lastFinish([3, 1, 2], 2)
-> 3     A takes 3, busy [0,3]. B takes 1, busy [0,1]. B is free earliest, so
         B takes 2 at time 1, busy [1,3]. Last finish is max(3, 3) = 3.

lastFinish([4, 1, 1, 1], 2)
-> 4     A: [0,4]. B: [0,1], then [1,2], then [2,3]. max(4, 3) = 4.

lastFinish([5, 5, 5], 1)
-> 15    one worker, strictly sequential

lastFinish([5, 5, 5], 10)
-> 5     more workers than jobs, so all three start at 0

lastFinish([], 4)
-> 0     nothing to run

lastFinish([0, 0], 1)
-> 0     zero-duration jobs finish the instant they start
```

## Signature

```ts
export function lastFinish(jobs: number[], workers: number): number
```

## Provenance — read this

**This exercise is a reconstruction, not a CrowdStrike question.** Candidate
reports mention a coding problem where a heap was the intended data structure,
but none of them records what the problem actually was. Rather than invent a
question and attach a company's name to it, this is a representative
medium-difficulty exercise built to drill the same decision: recognising that
repeatedly needing *the smallest of a changing set* is what a heap is for.

Do not treat it as a prediction of what you will be asked.

## Run it

```bash
pnpm test least-loaded-worker     # attempt
pnpm reset least-loaded-worker    # start over from a clean stub
```
