# Kth Largest Element in a Stream — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/heap-top-k/kth-largest-stream/` or given up on it for the session.

## The observation

You never need the whole history. Only the k largest values ever seen can
possibly be the answer or become the answer later — everything else is
permanently irrelevant, no matter how many more values arrive, because
nothing smaller than the current k-th largest can ever beat its way back
into the top k without first displacing something that's already in it.

So keep exactly k values around: the k largest seen so far. The smallest of
those k is, by definition, the k-th largest overall — so if that structure
can hand you its minimum cheaply, that minimum *is* the answer on every
call.

That's a min-heap of size k:

- If the heap has fewer than k entries, the new value always gets added —
  every entry counts toward "the k largest so far" when there aren't k of
  them yet, which is also why the answer before the heap fills up is the
  minimum of everything seen (rung 3 in the ladder: the heap's root, whatever
  is currently in it).
- Once the heap has k entries, a new value only matters if it's bigger than
  the current smallest of the k largest (the heap's root). If it is, it
  replaces the root and the heap re-settles. If it isn't, the new value can
  never be in the top k as long as those k survive, so it's safe to ignore
  after noting it (nothing else needs to happen to it).
- The root is always the answer.

## Why a min-heap, for the *largest*?

This is the part that trips people up: the target is the k-th **largest**
value, and the structure that solves it is a **min**-heap, not a max-heap.

A max-heap would hand you the single largest value at the root — useful for
k = 1, useless for anything else, because a max-heap's structure doesn't
give you cheap access to its k-th biggest element in general.

The trick is that you don't need a structure over *all* the data that can
answer "what's the k-th largest" — you need a structure over just the *top k*
that can answer "what's the smallest one, so I know what to evict." That
reframes the question from "rank within everything" (hard, needs the whole
order) to "minimum of a fixed-size working set" (cheap, a min-heap's whole
reason to exist). The heap is ordered by the opposite direction from the
quantity you're ultimately asked for, because its job is gatekeeping the
set, not ranking the answer.

## Reference solution

```ts
export class KthLargest {
  private readonly k: number
  private readonly heap: number[] = []

  constructor(k: number, nums: number[]) {
    this.k = k
    for (const n of nums) this.push(n)
  }

  add(val: number): number {
    this.push(val)
    return this.heap[0]!
  }

  private push(val: number): void {
    if (this.heap.length < this.k) {
      this.heap.push(val)
      this.siftUp(this.heap.length - 1)
      return
    }
    if (val > this.heap[0]!) {
      this.heap[0] = val
      this.siftDown(0)
    }
  }

  private siftUp(i: number): void {
    let child = i
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.heap[parent]! <= this.heap[child]!) break
      ;[this.heap[parent], this.heap[child]] = [this.heap[child]!, this.heap[parent]!]
      child = parent
    }
  }

  private siftDown(i: number): void {
    let parent = i
    const n = this.heap.length
    for (;;) {
      const left = 2 * parent + 1
      const right = 2 * parent + 2
      let smallest = parent
      if (left < n && this.heap[left]! < this.heap[smallest]!) smallest = left
      if (right < n && this.heap[right]! < this.heap[smallest]!) smallest = right
      if (smallest === parent) break
      ;[this.heap[parent], this.heap[smallest]] = [this.heap[smallest]!, this.heap[parent]!]
      parent = smallest
    }
  }
}
```

`siftUp` restores the heap property after appending at the end (bubbling a
too-small value up toward the root); `siftDown` restores it after
overwriting the root (bubbling a too-big value down toward the leaves).
Every `add` triggers at most one of the two, on a structure that never grows
past k entries.

## Complexity

- **Time:** each `add` is one comparison against the root, and — only when
  it matters — one sift bounded by the heap's height. The heap never holds
  more than k entries, so that height is bounded by k regardless of how long
  the stream runs. Construction does the same push k (or fewer) times, plus
  a discard-only check for the rest of the initial array.
- **Space:** the heap holds at most k entries, independent of stream length.

The whole point is that neither of these depends on how much history has
gone by — only on k. A brute force that keeps the full history and re-sorts
it on every call does depend on history length, and that dependence is
exactly what the scale test in `solution.test.ts` is built to catch.

## Sibling problems (same pattern)

- **Top K Frequent Elements** — same fixed-size-heap discipline, but the
  heap orders by frequency count instead of raw value.
- **K Closest Points to Origin** — same shape again, ordered by distance,
  with a max-heap of size k this time (largest-distance-so-far needs
  evicting, which is the mirror image of this problem).
- **Merge K Sorted Lists** — a different use of the same structure: instead
  of bounding *which* k things you keep, it bounds *how many* candidates
  you're ever comparing at once (one per list).
- **Sliding Window Median / Two Heaps** — splits the working set across a
  min-heap and a max-heap instead of just one, but the eviction logic (a
  value that fell out of range gets removed, the invariant gets restored)
  rhymes with this problem's replace-and-resettle step.

## The tell

You're asked for something about the "top k" or "k-th something" of a set
that keeps growing, and re-deriving the answer from the full set every time
you're asked is clearly wasteful. If the size of the answer-relevant subset
is fixed at k regardless of how much data has streamed by, that's the signal
to bound a structure at size k instead of growing it with the input.

## Interview notes

- Say the observation out loud before coding: only k values ever matter, and
  the object of interest is the smallest one *among* those k, not the
  overall data. That reframing is the entire justification for going with
  the "wrong-direction" heap.
- Common bug: comparing the incoming value against the max instead of the
  min-heap's root, or forgetting the `< k` branch (unconditionally comparing
  against the root before the heap is even full drops values that should
  have been kept).
- State explicitly what happens before the heap has k entries — interviewers
  often ask this as a follow-up, and it's easy to hand-wave.
- Watch for duplicate values: nothing about this approach requires
  deduplication, and an interviewer may probe on why not (each entry has to
  be tracked independently since the same value could occupy more than one
  of the top k ranks).
