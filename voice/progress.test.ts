import { describe, expect, it } from 'vitest'
import { progressByDifficulty } from './progress'
import type { CodingProblem } from './problems'
import type { HistoryRow } from './drill-log'

function problem(slug: string, difficulty: CodingProblem['difficulty']): CodingProblem {
  return { slug, pattern: 'irrelevant-for-this-test', difficulty }
}

function row(problemSlug: string, solved: boolean, hints: number): HistoryRow {
  return { date: '2026-08-01', problem: problemSlug, pattern: 'irrelevant-for-this-test', solved, hints, elapsedMs: 0, note: '' }
}

describe('progressByDifficulty', () => {
  it('buckets a never-attempted problem as unattempted', () => {
    const result = progressByDifficulty([problem('a', 'easy')], [])
    const easy = result.find((r) => r.difficulty === 'easy')!
    expect(easy).toEqual({ difficulty: 'easy', cold: 0, helped: 0, unsolved: 0, unattempted: 1, total: 1 })
  })

  it('buckets a problem solved cold at least once as cold, even with a later helped attempt', () => {
    const result = progressByDifficulty([problem('a', 'medium')], [row('a', true, 0), row('a', true, 2)])
    const medium = result.find((r) => r.difficulty === 'medium')!
    expect(medium).toMatchObject({ cold: 1, helped: 0, unsolved: 0, unattempted: 0 })
  })

  // The gap AGENTS.md calls out by name: "a solve that took four hints is a
  // different fact from a cold solve, and the log is useless if it flattens
  // them." A single "solved" number would merge these two rows.
  it('never collapses cold and helped into the same count', () => {
    const problems = [problem('cold-one', 'medium'), problem('helped-one', 'medium')]
    const rows = [row('cold-one', true, 0), row('helped-one', true, 3)]
    const result = progressByDifficulty(problems, rows)
    const medium = result.find((r) => r.difficulty === 'medium')!
    expect(medium.cold).toBe(1)
    expect(medium.helped).toBe(1)
  })

  it('buckets an attempted-but-never-solved problem as unsolved, not helped', () => {
    const result = progressByDifficulty([problem('a', 'hard')], [row('a', false, 4), row('a', false, 2)])
    const hard = result.find((r) => r.difficulty === 'hard')!
    expect(hard).toMatchObject({ cold: 0, helped: 0, unsolved: 1, unattempted: 0 })
  })

  it('covers warmup, easy, medium and hard, in that order', () => {
    const result = progressByDifficulty([], [])
    expect(result.map((r) => r.difficulty)).toEqual(['warmup', 'easy', 'medium', 'hard'])
  })

  // Unrated problems are real problems, but they are not one of the four tiers
  // this screen buckets by, and must not silently create a fifth row or get
  // folded into one of the four that has nothing to do with their difficulty.
  it('excludes unrated problems from every bucket rather than misfiling them', () => {
    const result = progressByDifficulty([problem('a', 'unrated')], [])
    expect(result.map((r) => r.difficulty)).toEqual(['warmup', 'easy', 'medium', 'hard'])
    expect(result.every((r) => r.total === 0)).toBe(true)
  })

  it('has each total match the count of problems in that tier', () => {
    const problems = [problem('a', 'easy'), problem('b', 'easy'), problem('c', 'medium')]
    const result = progressByDifficulty(problems, [])
    expect(result.find((r) => r.difficulty === 'easy')!.total).toBe(2)
    expect(result.find((r) => r.difficulty === 'medium')!.total).toBe(1)
  })

  it('never mentions a pattern in its output', () => {
    const problems = [problem('a', 'easy')]
    const rows = [row('a', true, 1)]
    const body = JSON.stringify(progressByDifficulty(problems, rows))
    expect(body).not.toContain('irrelevant-for-this-test')
  })
})
