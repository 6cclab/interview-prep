# A Cache with a Capacity — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/eviction-cache/lru-cache/` or given up on it for the session.

## The observation

There are two questions to answer, and no single structure answers both.

1. **"Do I hold this key, and what is its value?"** A hash map answers this in
   O(1) and always has.
2. **"Which held key has gone longest without being used?"** A hash map has
   nothing to say about this. It has no order.

Every wrong version of this problem comes from trying to make one structure do
both jobs — an array searched for the smallest timestamp, a list walked to its
end, a re-sort on each write. All of them are correct. All of them are
O(capacity) per operation, which is the one thing the problem forbids.

So keep both structures, side by side, holding the same entries. The map for
lookup, an **ordered structure** for recency. The ordered structure has to
support exactly three operations in constant time:

- move a **known** entry to the fresh end (on every get and every put)
- read the stale end (to find the victim)
- remove from the stale end (to evict)

## Why a doubly-linked list, and the detail that makes it work

A doubly-linked list does all three. Splicing a node out is `node.prev.next =
node.next; node.next.prev = node.prev` — constant time, no walking, **provided
you already have the node**.

That proviso is the entire trick, and it is where people lose the problem: the
map must store the **node**, not the value. `Map<number, Node>`. Then `get(key)`
is one map lookup to find the node, one splice to move it to the fresh end, and
`node.value` to return. Nothing is ever searched.

If the map stores the value instead, you have to find the node by walking the
list, and you are back to O(capacity) with extra bookkeeping.

Use **sentinel head and tail nodes** that always exist and hold no data. Every
real node then has a non-null `prev` and `next`, so splice and insert have no
special cases — no "is this the only node", no "is this the head". The capacity-1
test in the suite exists precisely because that is where the hand-rolled
edge cases break.

## The JavaScript route, which is not a cheat

A JS `Map` iterates in **insertion order**, and that gives you the ordered
structure for free:

- `map.delete(key); map.set(key, value)` moves a key to the fresh end
- `map.keys().next().value` is the stalest key, in O(1)

Both operations are constant time, so this is a genuinely O(1) solution, not a
shortcut that passes the suite by luck. It is about fifteen lines instead of
sixty.

**Say which one you are doing and why.** If you reach for the Map version,
volunteer that you know the language-independent answer is a map plus a doubly
linked list, and that you are using an ordering guarantee the spec gives you. An
interviewer who wanted the linked list will ask for it, and you have just shown
you can do both. Reaching for it silently is the version that reads as not
knowing.

## Reference solution — map plus doubly-linked list

```ts
interface Node {
  key: number
  value: number
  prev: Node | null
  next: Node | null
}

export class Cache {
  private readonly capacity: number
  private readonly map = new Map<number, Node>()
  // Sentinels. head.next is the stalest entry; tail.prev is the freshest.
  private readonly head: Node = { key: 0, value: 0, prev: null, next: null }
  private readonly tail: Node = { key: 0, value: 0, prev: null, next: null }

  constructor(capacity: number) {
    this.capacity = capacity
    this.head.next = this.tail
    this.tail.prev = this.head
  }

  private unlink(node: Node): void {
    node.prev!.next = node.next
    node.next!.prev = node.prev
  }

  private appendFresh(node: Node): void {
    node.prev = this.tail.prev
    node.next = this.tail
    this.tail.prev!.next = node
    this.tail.prev = node
  }

  get(key: number): number {
    const node = this.map.get(key)
    if (node === undefined) return -1
    this.unlink(node)
    this.appendFresh(node)
    return node.value
  }

  put(key: number, value: number): void {
    const existing = this.map.get(key)
    if (existing !== undefined) {
      existing.value = value
      this.unlink(existing)
      this.appendFresh(existing)
      return
    }

    if (this.map.size === this.capacity) {
      const stalest = this.head.next!
      this.unlink(stalest)
      this.map.delete(stalest.key)
    }

    const node: Node = { key, value, prev: null, next: null }
    this.appendFresh(node)
    this.map.set(key, node)
  }
}
```

Note `stalest.key`. The node has to carry its own key, because eviction starts
from the list and has to reach into the map to delete the right entry. A node
holding only a value leaves you with an orphaned map entry pointing at a node
that is no longer in the list — a leak that grows until the map is full of dead
keys and `get` starts returning values for entries that were evicted. Nothing in
the suite's small fixtures catches that; the scale tests do.

## Reference solution — the Map version

```ts
export class Cache {
  private readonly capacity: number
  private readonly map = new Map<number, number>()

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get(key: number): number {
    if (!this.map.has(key)) return -1
    const value = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, value) // re-inserting moves it to the fresh end
    return value
  }

  put(key: number, value: number): void {
    // Delete first so an overwrite also refreshes recency.
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size === this.capacity) {
      this.map.delete(this.map.keys().next().value as number)
    }
    this.map.set(key, value)
  }
}
```

`has` before `get`, not a falsiness check on the value — `0` is a legal stored
value and `-1` is the miss sentinel. The suite tests that directly.

## Cost

**O(1) for both operations**, amortised over the hash map. No operation's work
depends on how many entries are held: a map lookup, a fixed number of pointer
writes, and at most one eviction that also touches a fixed number of pointers.

**O(capacity) space.** The map and the list hold the same entries, so it is two
constant factors on the same count, not a larger order.

## The bug that survives the small tests

Evicting from the list but forgetting to delete from the map. Every fixture with
a handful of keys still passes, because nothing looks the dead key up again. It
shows as a store that grows without bound and eventually answers `get` for a key
it evicted. When you finish, check that every path which removes an entry
removes it from **both** structures — that pairing is the invariant the whole
design rests on.
