import { describe, expect, it } from 'vitest'
import { easiest, groupByTier, rank, TIERS } from './tiers'

const CODING = {
  celebrity: 'medium',
  'climbing-stairs': 'easy',
  'n-queens-count': 'hard',
  'reverse-list': 'warmup',
}

describe('rank', () => {
  it('orders the known tiers easiest first', () => {
    expect(rank('warmup')).toBeLessThan(rank('easy'))
    expect(rank('easy')).toBeLessThan(rank('medium'))
    expect(rank('medium')).toBeLessThan(rank('hard'))
  })

  it('sorts an unknown or absent tier last', () => {
    expect(rank('spicy')).toBe(TIERS.length)
    expect(rank(undefined)).toBe(TIERS.length)
    expect(rank('hard')).toBeLessThan(rank('spicy'))
  })
})

describe('easiest', () => {
  // The point of putting tiers on screen at all: after five years away the
  // default should be the gentle problem, not whichever slug sorts first.
  it('defaults to the warm-up rather than the alphabetically first slug', () => {
    const problems = ['celebrity', 'climbing-stairs', 'n-queens-count', 'reverse-list']
    expect(easiest(problems, CODING)).toBe('reverse-list')
  })

  it('keeps the server order within a tier', () => {
    expect(easiest(['b', 'a'], { a: 'easy', b: 'easy' })).toBe('b')
  })

  it('falls back to the first problem when no tiers are known', () => {
    expect(easiest(['rate-limiter', 'notification-fanout'], {})).toBe('rate-limiter')
  })

  it('is empty for an empty list', () => {
    expect(easiest([], {})).toBe('')
  })
})

describe('groupByTier', () => {
  it('groups easiest first and drops empty tiers', () => {
    const problems = ['celebrity', 'climbing-stairs', 'reverse-list']
    const groups = groupByTier(problems, CODING)!
    expect(groups.map((group) => group.problems)).toEqual([['reverse-list'], ['climbing-stairs'], ['celebrity']])
    // 'hard' and 'unrated' hold nothing here, so they are not rendered at all.
    expect(groups).toHaveLength(3)
  })

  // The design track reports no difficulty at all. One catch-all optgroup would
  // be pure noise, so the picker must fall back to a flat list.
  it('is null when nothing has a tier', () => {
    expect(groupByTier(['rate-limiter', 'notification-fanout'], {})).toBeNull()
  })

  it('is null for an empty list', () => {
    expect(groupByTier([], {})).toBeNull()
  })

  // A tier this client has never heard of must not be able to hide a problem.
  it('still lists a problem whose tier is unrecognised, after the known tiers', () => {
    const groups = groupByTier(['celebrity', 'mystery'], { celebrity: 'medium', mystery: 'spicy' })!
    expect(groups.flatMap((group) => group.problems)).toEqual(['celebrity', 'mystery'])
    expect(groups.at(-1)).toEqual({ label: 'spicy', problems: ['mystery'] })
  })

  it('files a problem missing from the tier map under unrated', () => {
    const groups = groupByTier(['celebrity', 'orphan'], { celebrity: 'medium' })!
    expect(groups.flatMap((group) => group.problems)).toEqual(['celebrity', 'orphan'])
    expect(groups.find((group) => group.problems.includes('orphan'))!.label).toContain('Unrated')
  })

  it('loses no problem, whatever the tiers are', () => {
    const problems = ['a', 'b', 'c', 'd']
    const groups = groupByTier(problems, { a: 'hard', b: 'warmup', c: 'nonsense' })!
    expect(groups.flatMap((group) => group.problems).sort()).toEqual(problems)
  })
})
