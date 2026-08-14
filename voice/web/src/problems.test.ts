import { describe, expect, it } from 'vitest'
import { companiesOf, difficultiesOf, filterProblems, joinSolvedState } from './problems'
import type { HistoryRow, ProblemDetail } from './types'

// Only the pure join/filter logic is exercised here — same rule as
// route.test.ts: Problems.tsx itself is a thin renderer over these functions,
// with no logic of its own worth a DOM harness for.

function problem(overrides: Partial<ProblemDetail> = {}): ProblemDetail {
  return {
    slug: 'two-sum-sorted',
    title: 'Two Sum (sorted)',
    difficulty: 'easy',
    companies: [],
    ...overrides,
  }
}

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    date: '2026-01-01',
    problem: 'two-sum-sorted',
    solved: true,
    hints: 0,
    elapsedMs: 1000,
    note: '',
    ...overrides,
  }
}

describe('joinSolvedState', () => {
  it('marks a problem with no rows as unattempted', () => {
    const [joined] = joinSolvedState([problem()], [])
    expect(joined!.solvedState).toBe('unattempted')
    expect(joined!.hasAttempt).toBe(false)
  })

  it('marks a problem whose only attempt failed as unsolved', () => {
    const [joined] = joinSolvedState([problem()], [row({ solved: false, hints: 2 })])
    expect(joined!.solvedState).toBe('unsolved')
    expect(joined!.hasAttempt).toBe(true)
  })

  it('marks a solve with hints as helped', () => {
    const [joined] = joinSolvedState([problem()], [row({ solved: true, hints: 2 })])
    expect(joined!.solvedState).toBe('helped')
  })

  it('marks a solve with zero hints as cold', () => {
    const [joined] = joinSolvedState([problem()], [row({ solved: true, hints: 0 })])
    expect(joined!.solvedState).toBe('cold')
  })

  // A cold solve anywhere in the log outranks a later worse attempt: it is
  // still evidence the pattern was once recalled without help.
  it('prefers a cold solve over a later helped one', () => {
    const rows = [row({ date: '2026-01-01', solved: true, hints: 0 }), row({ date: '2026-02-01', solved: true, hints: 3 })]
    const [joined] = joinSolvedState([problem()], rows)
    expect(joined!.solvedState).toBe('cold')
  })

  it('prefers a cold solve over a later failed attempt', () => {
    const rows = [row({ date: '2026-01-01', solved: true, hints: 0 }), row({ date: '2026-02-01', solved: false, hints: 4 })]
    const [joined] = joinSolvedState([problem()], rows)
    expect(joined!.solvedState).toBe('cold')
  })

  it('prefers any solve over a failed one when there is no cold solve', () => {
    const rows = [row({ date: '2026-01-01', solved: false, hints: 4 }), row({ date: '2026-02-01', solved: true, hints: 1 })]
    const [joined] = joinSolvedState([problem()], rows)
    expect(joined!.solvedState).toBe('helped')
  })

  it('only counts rows for its own slug', () => {
    const rows = [row({ problem: 'container-with-most-water', solved: true, hints: 0 })]
    const [joined] = joinSolvedState([problem()], rows)
    expect(joined!.solvedState).toBe('unattempted')
    expect(joined!.hasAttempt).toBe(false)
  })

  it('preserves every field of the source problem', () => {
    const source = problem({ companies: [{ name: 'Google', confidence: 'high' }] })
    const [joined] = joinSolvedState([source], [])
    expect(joined).toMatchObject(source)
  })
})

describe('filterProblems', () => {
  const problems = joinSolvedState(
    [
      problem({ slug: 'a', difficulty: 'easy', companies: [{ name: 'Google', confidence: 'high' }] }),
      problem({ slug: 'b', difficulty: 'hard', companies: [{ name: 'Meta', confidence: 'low' }] }),
      problem({ slug: 'c', difficulty: 'easy', companies: [{ name: 'Meta', confidence: 'high' }] }),
    ],
    [row({ problem: 'a', solved: true, hints: 0 }), row({ problem: 'b', solved: false, hints: 3 })],
  )

  it('passes everything through with no filters', () => {
    expect(filterProblems(problems, {})).toHaveLength(3)
  })

  it('filters by difficulty', () => {
    expect(filterProblems(problems, { difficulty: 'easy' }).map((p) => p.slug)).toEqual(['a', 'c'])
  })

  it('filters by solved-state', () => {
    expect(filterProblems(problems, { solvedState: 'unattempted' }).map((p) => p.slug)).toEqual(['c'])
  })

  it('filters by company', () => {
    expect(filterProblems(problems, { company: 'Meta' }).map((p) => p.slug)).toEqual(['b', 'c'])
  })

  it('ANDs every filter that is set', () => {
    expect(filterProblems(problems, { difficulty: 'easy', company: 'Meta' }).map((p) => p.slug)).toEqual(['c'])
  })

  it('excludes everything when a filter matches nothing', () => {
    expect(filterProblems(problems, { difficulty: 'medium' })).toEqual([])
  })
})

describe('companiesOf', () => {
  it('dedupes and sorts', () => {
    const problems = [
      problem({ companies: [{ name: 'Meta', confidence: 'high' }, { name: 'Google', confidence: 'low' }] }),
      problem({ companies: [{ name: 'Google', confidence: 'high' }] }),
    ]
    expect(companiesOf(problems)).toEqual(['Google', 'Meta'])
  })

  it('is empty when no problem has a company', () => {
    expect(companiesOf([problem()])).toEqual([])
  })
})

describe('difficultiesOf', () => {
  it('dedupes and sorts', () => {
    const problems = [problem({ difficulty: 'hard' }), problem({ difficulty: 'easy' }), problem({ difficulty: 'hard' })]
    expect(difficultiesOf(problems)).toEqual(['easy', 'hard'])
  })
})
