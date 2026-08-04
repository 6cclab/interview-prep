import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'
import { findCelebrity } from './solution'

/**
 * Build a knows-matrix for a party of `n` where `celebrity` (or nobody, when
 * null) satisfies both celebrity properties.
 *
 * The no-celebrity case uses a total order (a knows b whenever a < b) plus
 * one wraparound edge (n-1 knows 0). The celebrity case uses the same
 * total-order backbone among the non-celebrities, plus every non-celebrity
 * knowing the celebrity.
 *
 * Both branches are dense rather than sparse, and that is deliberate. In a
 * sparse matrix almost every candidate has a single disqualifying witness
 * sitting in a predictable place, so a brute force that happens to probe
 * that place first rejects each candidate in one or two calls and sneaks
 * under an O(n) budget while doing O(n^2) work. Here every candidate `a`
 * has a whole block of witnesses — every index above `a` in the order.
 * Density alone does not close off the shortcut, though: in this unpermuted
 * order the topmost index has fewer witnesses than anyone else, so probing
 * it first is still a cheap, predictable win. What actually removes the
 * shortcut is the random relabelling described below, which scatters where
 * that "topmost" index ends up from one party to the next.
 *
 * Density alone is still not enough, because the layout of those witnesses
 * is itself structured: they all sit on one side of the candidate. Any
 * fixed probe order that runs with the grain of the order (from the high
 * end, or wrapping around) finds a witness in a call or two, and any order
 * that runs against it pays O(n) per candidate. Which orders are cheap is
 * therefore an artifact of the labelling, not of the algorithm.
 *
 * So the budget is not asserted on a handful of hand-picked fixtures. It is
 * asserted across many parties built by `permutedParty`, each of which
 * applies a fresh random relabelling on top of this builder. Relabelling
 * preserves the celebrity properties exactly while scattering each
 * candidate's witnesses to uniformly random positions, so a fixed probe
 * order has no better strategy than sampling at random: it expects to burn
 * ~n/(witnesses+1) probes per candidate, and candidates late in the order
 * have very few witnesses. Across a wide sweep of brute-force variants and
 * multiple seeds, no fixed probe order has stayed under the budget on every
 * relabelling — see solutions/elimination/celebrity.md (spoiler) for why a
 * correct solution comfortably fits under it. The randomness is seeded (see
 * `SEED`), so the suite is fully deterministic and reproducible.
 */
function party(n: number, celebrity: number | null): boolean[][] {
  if (celebrity === null && n === 1) {
    throw new Error('party(1, null) is impossible: a lone person is vacuously a celebrity')
  }

  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
  for (let a = 0; a < n; a++) m[a]![a] = true

  if (celebrity === null) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) m[a]![b] = true
    }
    if (n > 1) m[n - 1]![0] = true
    return m
  }

  for (let a = 0; a < n; a++) {
    if (a === celebrity) continue
    m[a]![celebrity] = true
    for (let b: number = a + 1; b < n; b++) if (b !== celebrity) m[a]![b] = true // : number is load-bearing — plain `let b` here trips TS7022. The similar loop above doesn't need this annotation; removing it here breaks pnpm typecheck.
  }
  return m
}

/** Fixed seed: the budget tests are randomised but fully reproducible. */
const SEED = 0x5eed_1234

/** mulberry32 — a small self-contained PRNG so the suite never uses Math.random(). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Build a party via `party` and relabel it by a random permutation.
 *
 * `labels[newIndex]` is the original index that now sits at `newIndex`, so
 * `out[a]![b]` is `m[labels[a]]![labels[b]]`. Relabelling is an isomorphism
 * of the knows-relation: the celebrity properties, and the absence of a
 * celebrity, survive untouched — only the positions move.
 */
function permutedParty(
  n: number,
  celebrity: number | null,
  rand: () => number,
): { m: boolean[][]; celebrity: number } {
  const m = party(n, celebrity)

  const labels = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[labels[i], labels[j]] = [labels[j]!, labels[i]!]
  }

  const permuted = Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) => m[labels[a]!]![labels[b]!]!),
  )

  return {
    m: permuted,
    celebrity: celebrity === null ? -1 : labels.indexOf(celebrity),
  }
}

function oracleFor(m: boolean[][]) {
  return countCalls((a: number, b: number) => m[a]![b]!)
}

describe('findCelebrity — correctness', () => {
  it('finds the celebrity in a party of two', () => {
    const knows = oracleFor(party(2, 1))
    expect(findCelebrity(2, knows.fn)).toBe(1)
  })

  it('returns 0 for a party of one', () => {
    const knows = oracleFor(party(1, 0))
    expect(findCelebrity(1, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the first index', () => {
    const knows = oracleFor(party(6, 0))
    expect(findCelebrity(6, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the last index', () => {
    const knows = oracleFor(party(6, 5))
    expect(findCelebrity(6, knows.fn)).toBe(5)
  })

  it('finds a celebrity in the middle', () => {
    const knows = oracleFor(party(9, 4))
    expect(findCelebrity(9, knows.fn)).toBe(4)
  })

  it('returns -1 when nobody is known by everyone', () => {
    const knows = oracleFor(party(5, null))
    expect(findCelebrity(5, knows.fn)).toBe(-1)
  })

  it('returns -1 when the candidate knows somebody', () => {
    const m = party(4, 2)
    m[2]![3] = true // person 2 is known by all, but knows 3 — not a celebrity
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })

  it('returns -1 when one person fails to know the candidate', () => {
    const m = party(4, 2)
    m[3]![2] = false // person 3 does not know 2
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })
})

describe('findCelebrity — budget', () => {
  // The 3n bound below is tight by design — see
  // solutions/elimination/celebrity.md (spoiler) for why a correct solution
  // comfortably fits under it while an O(n^2) brute force does not.
  //
  // Both tests below run TRIALS randomly relabelled parties and assert the
  // budget on every one of them. A fixed probe order that gets lucky on one
  // labelling will not get lucky on twenty; see the comment on `party`.
  const TRIALS = 20

  it('stays within 3n knows() calls on a large party', () => {
    const n = 500
    const rand = mulberry32(SEED)

    for (let trial = 1; trial <= TRIALS; trial++) {
      const celebrity = Math.floor(rand() * n)
      const p = permutedParty(n, celebrity, rand)
      const knows = oracleFor(p.m)

      expect(findCelebrity(n, knows.fn)).toBe(p.celebrity)
      assertWithinBudget(
        knows.calls,
        3 * n,
        `knows() [trial ${trial}/${TRIALS}, seed 0x${SEED.toString(16)}]`,
      )
    }
  })

  it('stays within 3n knows() calls when there is no celebrity', () => {
    const n = 500
    const rand = mulberry32(SEED)

    for (let trial = 1; trial <= TRIALS; trial++) {
      const p = permutedParty(n, null, rand)
      const knows = oracleFor(p.m)

      expect(findCelebrity(n, knows.fn)).toBe(-1)
      assertWithinBudget(
        knows.calls,
        3 * n,
        `knows() [trial ${trial}/${TRIALS}, seed 0x${SEED.toString(16)}]`,
      )
    }
  })
})
