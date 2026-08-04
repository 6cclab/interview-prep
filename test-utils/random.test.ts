import { describe, expect, it } from 'vitest'
import { mulberry32, randomPermutation, seededTrials, shuffled } from './random'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(0x5eed_1234)
    for (let i = 0; i < 1000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('seededTrials', () => {
  it('invokes body exactly `trials` times with incrementing trial indices', () => {
    const seenTrials: number[] = []
    seededTrials(1, 5, (_rng, trial) => {
      seenTrials.push(trial)
    })
    expect(seenTrials).toEqual([1, 2, 3, 4, 5])
  })

  it('is reproducible across two runs with the same seed', () => {
    const collect = () => {
      const draws: number[] = []
      seededTrials(99, 4, (rng) => {
        draws.push(rng())
      })
      return draws
    }
    expect(collect()).toEqual(collect())
  })

  it('runs body against a single continuous PRNG stream, not one reset per trial', () => {
    const draws: number[] = []
    seededTrials(7, 3, (rng) => {
      draws.push(rng())
    })

    const rng = mulberry32(7)
    const expected = [rng(), rng(), rng()]
    expect(draws).toEqual(expected)
  })
})

describe('shuffled', () => {
  it('returns a permutation: same multiset, same length', () => {
    const items = [1, 2, 3, 4, 5]
    const rng = mulberry32(123)
    const result = shuffled(items, rng)
    expect(result).toHaveLength(items.length)
    expect([...result].sort()).toEqual([...items].sort())
  })

  it('does not mutate its input', () => {
    const items = [1, 2, 3, 4, 5]
    const copy = [...items]
    shuffled(items, mulberry32(123))
    expect(items).toEqual(copy)
  })

  it('is deterministic for a given rng seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    const a = shuffled(items, mulberry32(555))
    const b = shuffled(items, mulberry32(555))
    expect(a).toEqual(b)
  })

  it('actually permutes the input across several seeds (rejects a no-op implementation)', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    let sawADifference = false
    for (let seed = 0; seed < 10; seed++) {
      const result = shuffled(items, mulberry32(seed))
      if (!result.every((value, index) => value === items[index])) {
        sawADifference = true
        break
      }
    }
    expect(sawADifference).toBe(true)
  })
})

describe('randomPermutation', () => {
  it('contains exactly 0..n-1 once each', () => {
    const n = 50
    const perm = randomPermutation(n, mulberry32(2024))
    expect(perm).toHaveLength(n)
    expect([...perm].sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, i) => i),
    )
  })

  it('handles n=0', () => {
    expect(randomPermutation(0, mulberry32(1))).toEqual([])
  })

  it('handles n=1', () => {
    expect(randomPermutation(1, mulberry32(1))).toEqual([0])
  })
})
