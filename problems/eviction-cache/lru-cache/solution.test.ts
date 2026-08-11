import { describe, expect, it } from 'vitest'
import { Cache } from './solution'

describe('Cache — correctness', () => {
  it('walks the canonical sequence', () => {
    const cache = new Cache(2)
    cache.put(1, 1)
    cache.put(2, 2)
    expect(cache.get(1)).toBe(1)
    cache.put(3, 3) // evicts 2, because the get above refreshed 1
    expect(cache.get(2)).toBe(-1)
    cache.put(4, 4) // evicts 1
    expect(cache.get(1)).toBe(-1)
    expect(cache.get(3)).toBe(3)
    expect(cache.get(4)).toBe(4)
  })

  it('returns -1 for a key never written', () => {
    const cache = new Cache(2)
    expect(cache.get(9)).toBe(-1)
    cache.put(1, 1)
    expect(cache.get(9)).toBe(-1)
  })

  it('treats a read as a use', () => {
    // The distinguishing test. If only writes counted, 1 would be the stalest
    // entry when 3 arrives and would be the one discarded — so this asserts
    // both halves: 1 survives AND 2 is the one that goes.
    const cache = new Cache(2)
    cache.put(1, 1)
    cache.put(2, 2)
    cache.get(1)
    cache.put(3, 3)
    expect(cache.get(1)).toBe(1)
    expect(cache.get(2)).toBe(-1)
  })

  it('treats overwriting an existing key as a use, and evicts nothing', () => {
    // 1 is stalest, then it is overwritten. That must refresh it, so the next
    // insertion discards 2 rather than 1. An implementation that updates the
    // map but forgets to touch the recency order fails here and nowhere else.
    const cache = new Cache(2)
    cache.put(1, 1)
    cache.put(2, 2)
    cache.put(1, 100)
    expect(cache.get(1)).toBe(100)
    cache.put(3, 3)
    expect(cache.get(2)).toBe(-1)
    expect(cache.get(1)).toBe(100)
    expect(cache.get(3)).toBe(3)
  })

  it('never exceeds capacity when overwriting', () => {
    // Three writes, two distinct keys, capacity 2. If an overwrite is treated
    // as an insertion, something gets evicted that should not have been.
    const cache = new Cache(2)
    cache.put(1, 1)
    cache.put(2, 2)
    cache.put(2, 22)
    expect(cache.get(1)).toBe(1)
    expect(cache.get(2)).toBe(22)
  })

  it('handles a capacity of one', () => {
    // The degenerate case, where every insertion evicts the previous entry.
    // A linked-list implementation that assumes head and tail are distinct
    // nodes tends to break here rather than at any larger size.
    const cache = new Cache(1)
    cache.put(1, 1)
    expect(cache.get(1)).toBe(1)
    cache.put(2, 2)
    expect(cache.get(1)).toBe(-1)
    expect(cache.get(2)).toBe(2)
    cache.put(2, 22)
    expect(cache.get(2)).toBe(22)
  })

  it('stores a zero value distinguishably from a miss', () => {
    // -1 is the miss sentinel, so 0 is an ordinary value. An implementation
    // that tests a looked-up value for falsiness reports a miss here.
    const cache = new Cache(2)
    cache.put(1, 0)
    expect(cache.get(1)).toBe(0)
  })

  it('keeps a repeatedly-read key forever', () => {
    // Key 1 is the oldest entry throughout but is read before every
    // insertion, so it is never the stalest and must never be discarded.
    const cache = new Cache(2)
    cache.put(1, 1)
    for (let k = 2; k < 20; k++) {
      expect(cache.get(1)).toBe(1)
      cache.put(k, k)
    }
    expect(cache.get(1)).toBe(1)
  })
})

describe('Cache — scale', () => {
  // Sizes are measured, not guessed. On the machine this was authored on, over
  // the insert-only workload below: a map beside a doubly-linked list runs in
  // ~43ms, a solution built on Map insertion order runs in ~974ms, and one that
  // scans its contents to pick a victim runs in ~15s. The budget sits at 5s, so
  // both constant-time designs clear it with room and the scanning one misses by
  // three times over.
  //
  // Capacity is deliberately modest and the operation count large, rather than
  // the reverse. Picking the victim via `map.keys().next()` degrades as the
  // number of deletions grows — V8 walks tombstoned slots — so a large capacity
  // punishes a legitimately constant-time solution for an implementation detail
  // of the engine rather than for its own cost. At capacity 50,000 that design
  // took 4,985ms against this same 5,000ms budget: passing, but by 15ms, which
  // is a coin toss dressed up as a verdict. Operation count separates the two
  // designs cleanly; capacity does not.
  const CAPACITY = 8_000

  /**
   * The expected values are derived analytically rather than by running a
   * second implementation: keys 0..TOTAL-1 are inserted in order and never
   * re-used, so every insertion past the first CAPACITY evicts the numerically
   * lowest surviving key. After the loop the store therefore holds exactly the
   * final CAPACITY keys, TOTAL-CAPACITY .. TOTAL-1, and nothing else.
   */
  it('finishes well within budget on a long insert-only workload', () => {
    const TOTAL = 600_000
    const cache = new Cache(CAPACITY)

    const t0 = performance.now()
    for (let key = 0; key < TOTAL; key++) cache.put(key, key * 2)
    const elapsed = performance.now() - t0

    // The newest key, and the oldest one that should have survived.
    expect(cache.get(TOTAL - 1)).toBe((TOTAL - 1) * 2)
    expect(cache.get(TOTAL - CAPACITY)).toBe((TOTAL - CAPACITY) * 2)
    // One key older than that, and the very first key, are both long gone.
    expect(cache.get(TOTAL - CAPACITY - 1)).toBe(-1)
    expect(cache.get(0)).toBe(-1)

    // Vitest's testTimeout does not reliably preempt a synchronous, CPU-bound
    // loop, so elapsed time is measured explicitly here rather than relied on
    // to fail the test on its own.
    expect(elapsed).toBeLessThan(5000)
  })

  /**
   * The same cost separation on a workload where **reads** drive the eviction
   * order, so a solution that is constant-time on insertion while scanning on
   * read is caught here rather than passing above.
   *
   * Also analytic. Key 0 is read immediately before every insertion, so it is
   * never the stalest entry and can never be evicted, however old it gets. Each
   * insertion therefore evicts the next-stalest: first the remaining original
   * keys 1..CAPACITY-1 in order, and after those are gone, the oldest surviving
   * new key. With ROUNDS well past CAPACITY, the store ends holding key 0 plus
   * the most recent CAPACITY-1 inserted keys, which are ROUNDS+1 .. ROUNDS+CAPACITY-1.
   */
  it('finishes well within budget when reads drive the eviction order', () => {
    const ROUNDS = 300_000
    const cache = new Cache(CAPACITY)
    for (let key = 0; key < CAPACITY; key++) cache.put(key, key * 2)

    const t0 = performance.now()
    for (let i = 0; i < ROUNDS; i++) {
      cache.get(0)
      const key = CAPACITY + i
      cache.put(key, key * 2)
    }
    const elapsed = performance.now() - t0

    // Read before every insertion, so never the stalest, so never evicted.
    expect(cache.get(0)).toBe(0)
    // Every other original key was, in order, the stalest at some point.
    expect(cache.get(1)).toBe(-1)
    expect(cache.get(CAPACITY - 1)).toBe(-1)
    // The newest arrival, and the oldest arrival still held.
    expect(cache.get(ROUNDS + CAPACITY - 1)).toBe((ROUNDS + CAPACITY - 1) * 2)
    expect(cache.get(ROUNDS + 1)).toBe((ROUNDS + 1) * 2)
    // One older than that is gone.
    expect(cache.get(ROUNDS)).toBe(-1)

    expect(elapsed).toBeLessThan(5000)
  })
})
