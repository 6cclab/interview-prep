# A Cache with a Capacity

Build a fixed-size key/value store. It holds at most `capacity` entries. When a
write would push it past that, the entry that has gone **longest without being
used** is thrown out to make room.

"Used" means either operation: reading a key counts as using it, and writing a
key counts as using it. So a key that is read constantly is never the one
evicted, however long ago it was first written.

```ts
class Cache {
  constructor(capacity: number)
  get(key: number): number   // the value, or -1 if the key is not held
  put(key: number, value: number): void
}
```

`put` on a key that is already held **updates its value** and counts as using
it. It never grows the store, so it never evicts anything.

## Constraints

- `1 <= capacity <= 100000`
- `0 <= key, value <= 10^9`
- Up to `10^6` calls to `get` and `put` combined
- **Every operation must be O(1).** This is the requirement the problem is
  about. A store that answers correctly but scans its contents to decide what
  to discard will be rejected by this problem's test suite, and the suite is
  sized so that it is rejected decisively rather than narrowly.

## Example

```
Cache(2)          capacity is 2

put(1, 1)         held: {1}
put(2, 2)         held: {1, 2}
get(1)   -> 1     held: {2, 1}      reading 1 makes 2 the stale one
put(3, 3)         held: {1, 3}      full, so 2 is evicted
get(2)   -> -1    2 is gone
put(4, 4)         held: {3, 4}      1 is now stalest, so 1 is evicted
get(1)   -> -1
get(3)   -> 3
get(4)   -> 4
```

Note the third line. If reading did not count as using, `1` would have been
discarded instead of `2`, and every answer after that point differs.

## Signature

```ts
export class Cache {
  constructor(capacity: number)
  get(key: number): number
  put(key: number, value: number): void
}
```

## Run it

```bash
pnpm test lru-cache     # attempt
pnpm reset lru-cache    # start over from a clean stub
```
