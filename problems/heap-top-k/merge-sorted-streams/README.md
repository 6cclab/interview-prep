# One Sorted Stream From Many

Telemetry arrives from several shards. Each shard gives you its own stream of
numbers, already sorted ascending within that shard. Across shards the values
interleave arbitrarily.

Expose a single stream that yields every value from every shard, in ascending
order overall.

```ts
[...mergeSorted([[1, 4, 7], [2, 3], [5]])]   //  [1, 2, 3, 4, 5, 7]
```

## The requirement that makes this interesting

**It must stay lazy.** A consumer that takes the first three values must not
cause the whole input to be read. So this is not "collect everything, sort it,
hand it back" — that answer is correct and this problem's test suite rejects it
by counting how much of each source you consumed.

Concretely: pulling `n` values from the merged stream must read only about `n`
values in total across the sources, plus a small constant per source to get
started. The suite allows a modest allowance, not an exact count.

A source may be **infinite**, and the suite includes one. Anything that drains a
source before producing its first value never terminates.

## Details that are easy to get wrong

- **Duplicates are values, not noise.** Three sources each containing `5` yield
  `5` three times.
- **Sources may be empty**, including all of them, including some-but-not-all.
- **There may be one source, or none at all.**
- Lengths are uneven; a source running dry must not end the merge.
- Values may be negative, and may repeat within a single source.

## Constraints

- `0 <= sources.length <= 10000`
- Each source is a JavaScript `Iterable<number>`, ascending within itself
- Sources may be lazy generators; do not assume `.length` or index access
- Each source may be iterated **once**

## Signature

```ts
export function mergeSorted(sources: Array<Iterable<number>>): Iterable<number>
```

The returned value must be iterable — `for...of` over it, spread it, or call
`[Symbol.iterator]()` on it directly.

## Run it

```bash
pnpm test merge-sorted-streams     # attempt
pnpm reset merge-sorted-streams    # start over from a clean stub
```
