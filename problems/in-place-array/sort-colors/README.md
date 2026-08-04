# Sort Colors

You are given `n` items, each labelled `0`, `1`, or `2`. You don't get the
items as a plain array — you get accessors instead:

- `get(i)` returns the label at index `i`.
- `set(i, v)` overwrites the label at index `i` with `v`.

Sort the items by label — all `0`s first, then all `1`s, then all `2`s —
using only `get` and `set` to observe and rearrange them. There is no other
way to inspect or mutate the collection.

## Constraints

- `0 <= n <= 5000`
- Every label is `0`, `1`, or `2`.
- The tests count how `get` and `set` are called. A solution that reads
  everything before it writes anything, or that touches the collection far
  more than a handful of times per item, will be rejected even if it
  produces the right final arrangement.

## Examples

```
n = 6, labels = [2, 0, 2, 1, 1, 0]
-> [0, 0, 1, 1, 2, 2]

n = 3, labels = [0, 1, 2]
-> [0, 1, 2]        (already sorted)

n = 0
-> []               (nothing to do)
```

## Signature

```ts
export function sortColors(
  n: number,
  get: (i: number) => number,
  set: (i: number, v: number) => void,
): void
```

`sortColors` returns nothing — it does its work entirely through `set`.

## Run it

```bash
pnpm test sort-colors     # attempt
pnpm reset sort-colors    # start over from a clean stub
```
