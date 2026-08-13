# Library Dependency Ordering — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/topological-sort/library-order/` or given up on it for the session.

## The observation

You are asked for an order, but the useful reframing is that **you are not
looking for an order, you are repeatedly looking for something with nothing left
blocking it.** A library can be initialized the moment every library it depends
on has already been initialized. So: find everything with no unmet dependency,
take it, and notice which libraries that unblocks.

That second half is the whole trick. The naive version rescans the remaining set
after every pick, asking each survivor "are you ready yet?" The efficient
version inverts the question: when you take a library, you already know exactly
who was waiting on it, so you go tell them directly.

Concretely, keep two things:

- **`dependents`** — for each library, the list of libraries that depend on *it*.
  This is the reverse of the input, and building it is the only preprocessing.
- **`pending`** — for each library, a count of how many of its dependencies are
  still uninitialized.

Seed a queue with everything whose `pending` is zero. Pop, append to the order,
and for each dependent decrement its count; when a count hits zero, that library
joins the queue. Each library is popped once and each edge is walked once, so
the whole thing is O(V + E).

The direction of the input pairs is worth slowing down on. `[x, y]` means *x
depends on y*, so **y comes first**. That means the edge you traverse runs
`y → x`, and the count you increment belongs to `x`. Getting this backwards
produces a perfectly valid-looking reversed order that passes the "does every
library appear exactly once" check and fails everything else.

## The cycle case falls out for free

Nothing about the loop above detects a cycle. It just… stops early. If `a`
depends on `b` and `b` depends on `a`, neither ever reaches a pending count of
zero, so neither ever enters the queue, and the loop ends with them still
sitting there.

So the check is a length comparison at the end:

```ts
return order.length === libraries.length ? order : null
```

If you emitted fewer libraries than you were given, whatever you did not emit is
in or downstream of a cycle. There is no separate cycle-detection pass, no
colored-node DFS, no recursion-stack tracking. This is the strongest argument
for this approach over a DFS-based topological sort in an interview: the failure
case costs one comparison.

Note that this also catches the self-dependency `[a, a]`, which is a cycle of
length one. A hand-rolled "does this pair appear reversed anywhere" cycle check
misses it, and the suite has a fixture for exactly that.

## The unknown-library case does not

The other `null` condition — a pair naming a library that isn't in the list — is
genuinely separate, and you have to check it explicitly while reading the pairs:

```ts
if (!pending.has(x) || !pending.has(y)) return null
```

Both sides. It is easy to validate only the dependency side and let an unknown
dependent slip through, where it silently becomes a library you never initialize
and, worse, makes the length check at the end fail for the wrong reason —
reporting a cycle where there is a typo.

## Duplicate pairs

The spec says pairs may repeat, and the same pair listed twice is redundant, not
an error. If you increment `pending` blindly, `[b, a]` appearing twice gives `b`
a count of 2 with only one real dependency, it never reaches zero, and you
report a cycle that does not exist.

Deduplicate as you read. A `Set` of `"x y"` keys is fine and is what the
reference does; a `Set` of dependents per library works equally well. What you
cannot do is skip this — the suite has a fixture for it, and it is the kind of
thing a real build system hits constantly.

## Where it goes quadratic

The cost trap is the rescanning solution:

```ts
// WRONG — correct answers, quadratic cost
while (remaining.size > 0) {
  const ready = [...remaining].find((lib) =>
    needs.get(lib).every((d) => done.has(d))
  )
  if (!ready) return null
  remaining.delete(ready)
  done.add(ready)
  order.push(ready)
}
```

This is completely correct. It also re-examines the entire remaining set after
every single pick, which is O(V²) when each pick frees only one library.

The scale test's shape is deliberate: a 40,000-long chain where each library
depends on the previous one, **listed newest-first**. Because the scan walks the
list in order, the one library that is ready sits at the far end every time.
Measured: 21ms for the pending-count solution, 24s for the rescan.

The listing order is not incidental, and this is worth internalizing. The *same*
brute force on the *same* graph listed oldest-first finds its pick on the first
or second look and runs in 330ms — 70x faster, still O(V²) on paper. An input
that is adversarial in shape but friendly in order will not expose this bug, and
that is exactly how a quadratic dependency resolver ships.

## What an interviewer is listening for

- Naming the reverse-index-plus-counter structure before writing it, rather than
  discovering it by refactoring a rescan.
- Saying out loud that the cycle check is the length comparison. Interviewers
  ask "how do you detect a cycle?" expecting a second algorithm; answering "I
  already have — anything I couldn't emit is in one" is the strong answer.
- Handling the unknown-name and duplicate-pair cases without being prompted.
  They are the two places this differs from the textbook version, and they are
  the two things a real dependency resolver deals with every day.
- O(V + E) time, O(V + E) space, stated plainly. If asked to justify the space:
  the reverse index is the same size as the input edge list.

## Complexity

- **Time** — O(V + E). Every library enters and leaves the queue once; every
  edge is walked once when its source is popped.
- **Space** — O(V + E) for the reverse index and the counters. The output is
  another O(V).
