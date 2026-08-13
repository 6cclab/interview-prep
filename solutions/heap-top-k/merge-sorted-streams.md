# Merge Multiple Sorted Iterators — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/heap-top-k/merge-sorted-streams/` or given up on it for the session.

## The observation

Each source is already ascending. That means **the smallest value you have not
yet emitted is the head of one of the sources** — you never have to look past
the first unconsumed element of anything.

So the state you carry is one value per source, not one value per element. Take
the smallest of those k heads, emit it, and replace it with the next value from
whichever source it came from. Repeat until every source is exhausted.

Finding the smallest of k things repeatedly, with replacement, is what an
ordered structure is for. A linear scan of the k heads is O(k) per emitted
value; a min-heap keyed on the head value makes it O(log k). With k sources and
n total values that is O(n log k) versus O(n·k).

The detail that trips people up: the heap does not hold values, it holds
**cursors** — a `{value, iterator}` pair. When you pop one you need to know
which source to pull from next, and a bare number cannot tell you. Storing the
source index alongside the value works just as well; storing only the value does
not work at all.

## Laziness is the actual requirement

This problem is not really about the merge. It is about *when* the merge runs.

The requirement is that taking 10 values reads about 10 values. That rules out
the shape almost everyone writes first:

```ts
// WRONG — right answers, reads everything
export function mergeSorted(sources) {
  const all = []
  for (const source of sources) for (const value of source) all.push(value)
  return all.sort((a, b) => a - b)
}
```

Six lines, correct output on every finite input, and it fails the drill three
different ways: it reads 500,000 values where 520 were budgeted, and it does not
terminate at all on a source that never ends.

The fix is to make the returned iterable *generate*, so no work happens until
someone asks:

```ts
return {
  *[Symbol.iterator]() {
    // heap set-up and merge loop live in here
  },
}
```

Putting the set-up inside the generator body rather than outside it matters.
Code above the `return` runs the moment `mergeSorted` is called; code inside the
generator runs on the first `next()`. Priming the heap outside means you have
already touched every source before the caller has asked for anything — a
smaller version of the same bug, and the reason the budget in the suite is
`k + n + slack` rather than just `n`.

That leading `k` is unavoidable and worth saying out loud: you cannot know which
source holds the global minimum without looking at every source's head once. One
pull per source is the floor, and the drill's budget allows exactly that.

## Infinite sources

A source may never end. That is not an exotic edge case bolted on to make the
problem harder — it is the natural consequence of laziness, and it is the
cleanest way to *prove* laziness, because a solution that drains its inputs does
not return a wrong answer here, it does not return at all.

The generator shape handles it without a single extra line. The merge loop
condition is "the heap is non-empty," and a source that never ends simply never
leaves the heap. You stop when the consumer stops asking.

## Edge cases and where they bite

- **A source that is empty.** Its first `next()` is already `done`, so it must
  never enter the heap. If you push a cursor with an undefined value, it sorts
  as `NaN` and quietly corrupts the ordering.
- **Every source empty, or no sources at all.** The heap starts empty, the loop
  body never runs, you yield nothing. Falls out for free if the priming step
  checks `done`; crashes on `heap[0]` if it doesn't.
- **Duplicates**, within a source and across sources. Nothing to do — the merge
  keeps them. Only a solution that deduplicates by accident (routing values
  through a `Set`) gets this wrong.
- **Wildly uneven lengths.** One source with a million values and four with two
  each is the normal case, not a stress case. The heap shrinks as sources
  exhaust, so the cost per value drops on its own.
- **Negative values.** Only a problem if you seeded a "current minimum" with `0`
  instead of comparing against the heads you actually have.

## What an interviewer is listening for

- Recognizing that per-source heads are the only state needed, before reaching
  for a data structure. The heap is an optimization on top of that idea, not the
  idea itself.
- Asking whether the sources can be infinite, or whether the caller might want
  only the first few. If the answer is yes to either, the materialize-and-sort
  approach is off the table for reasons of correctness, not performance — and
  saying that is a stronger signal than jumping straight to a heap.
- Being honest about when the simple version is right. If every source is a
  finite in-memory array and the caller always wants all of it, concatenating
  and sorting is O(n log n) against the merge's O(n log k), and with small k the
  difference is not worth the code. The senior answer is not "always use a
  heap," it is knowing which question you are being asked.
- O(n log k) time, O(k) space, and being able to say what n and k each are.

## Complexity

- **Time** — O(n log k) for n total values across k sources. Each value is
  pushed and popped once, each operation costing log k.
- **Space** — O(k). One cursor per source, regardless of how long the sources
  are. This is the number that makes an infinite source survivable.
