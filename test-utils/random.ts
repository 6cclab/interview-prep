/**
 * Test-harness utilities for drills whose difficulty depends on the *shape*
 * of the fixture, not just an operation budget (see `test-utils/oracle.ts`
 * for that other case).
 *
 * A drill is only worth doing if a correct-but-brute-force solution fails
 * it. Fixed, hand-picked fixtures are fragile: a brute force that happens
 * to probe in a lucky order can sneak under a budget or dodge a worst case
 * on any single fixture, and once someone finds that lucky order the test
 * stops proving anything. Randomised, seeded fixtures close that off — a
 * fixed probe order has to survive many independently-scattered geometries,
 * not just the one the author thought to write down. Seeding keeps the
 * suite fully deterministic and reproducible despite the randomness.
 */

/** A small self-contained PRNG so drills never depend on `Math.random()`. */
export function mulberry32(seed: number): () => number {
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
 * Run `body` `trials` times against a single PRNG stream seeded once from
 * `seed`.
 *
 * The PRNG is not reset between trials: trial N's inputs depend on every
 * `rng()` call made during trials 1..N-1, not just on `seed` and `trial`.
 * That's intentional — it's still fully deterministic for a given `seed`
 * and `trials`, and it means the trials collectively exercise a single long
 * pseudo-random walk rather than `trials` independent draws from the same
 * short prefix.
 */
export function seededTrials(
  seed: number,
  trials: number,
  body: (rng: () => number, trial: number) => void,
): void {
  const rng = mulberry32(seed)
  for (let trial = 1; trial <= trials; trial++) {
    body(rng, trial)
  }
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate `items`. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** A random permutation of `0..n-1`. */
export function randomPermutation(n: number, rng: () => number): number[] {
  const identity = Array.from({ length: n }, (_, i) => i)
  return shuffled(identity, rng)
}
