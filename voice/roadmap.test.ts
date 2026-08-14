import { describe, expect, it } from 'vitest'
import { buildRoadmap } from './roadmap'
import type { CodingProblemDetail } from './problems'
import type { HistoryRow } from './drill-log'

function problem(slug: string, pattern: string, title = slug): CodingProblemDetail {
  return { slug, pattern, title, difficulty: 'medium', companies: [] }
}

function row(problemSlug: string, pattern: string, solved: boolean, hints: number): HistoryRow {
  return { date: '2026-08-01', problem: problemSlug, pattern, solved, hints, elapsedMs: 0, note: '' }
}

describe('buildRoadmap', () => {
  it('groups an attempted problem under the pattern its own row names', () => {
    const groups = buildRoadmap([problem('a', 'two-pointers')], [row('a', 'two-pointers', true, 0)])
    expect(groups).toEqual([
      { pattern: 'two-pointers', problems: [{ slug: 'a', title: 'a', attempted: true, cold: true }] },
    ])
  })

  // The whole point of `?study=1`'s extra restriction, tested explicitly per
  // the task: a problem with no row must stay anonymous even though its real
  // pattern is known internally — the roadmap must not become the answer key
  // patterns.md already is, just grouped a different way.
  it('never names the pattern for an unattempted problem, even when its true pattern is already used above', () => {
    const groups = buildRoadmap(
      [problem('attempted-one', 'two-pointers'), problem('never-touched', 'two-pointers')],
      [row('attempted-one', 'two-pointers', true, 0)],
    )
    const anonymous = groups.find((g) => g.pattern === null)
    expect(anonymous?.problems.map((p) => p.slug)).toEqual(['never-touched'])
    // And the attempted problem's own group must not also carry the unattempted one.
    const named = groups.find((g) => g.pattern === 'two-pointers')
    expect(named?.problems.map((p) => p.slug)).toEqual(['attempted-one'])
  })

  it('marks an attempted-but-not-cold problem as attempted, not cold', () => {
    const groups = buildRoadmap([problem('a', 'two-pointers')], [row('a', 'two-pointers', true, 2)])
    expect(groups[0]!.problems[0]).toMatchObject({ attempted: true, cold: false })
  })

  it('marks an unattempted problem as neither attempted nor cold', () => {
    const groups = buildRoadmap([problem('a', 'two-pointers')], [])
    expect(groups).toEqual([{ pattern: null, problems: [{ slug: 'a', title: 'a', attempted: false, cold: false }] }])
  })

  it('omits the anonymous group entirely when every problem has been attempted', () => {
    const groups = buildRoadmap([problem('a', 'two-pointers')], [row('a', 'two-pointers', true, 0)])
    expect(groups.some((g) => g.pattern === null)).toBe(false)
  })

  it('groups multiple attempted problems sharing a pattern together', () => {
    const groups = buildRoadmap(
      [problem('a', 'heap-top-k'), problem('b', 'heap-top-k')],
      [row('a', 'heap-top-k', true, 0), row('b', 'heap-top-k', false, 1)],
    )
    const heap = groups.find((g) => g.pattern === 'heap-top-k')
    expect(heap?.problems.map((p) => p.slug).sort()).toEqual(['a', 'b'])
  })

  // A hand-edited row with an unrecognised pattern parses to '' — same case as
  // no pattern being recorded at all, and must not create a group keyed by
  // the empty string.
  it('treats a row with a blank pattern the same as no row at all', () => {
    const groups = buildRoadmap([problem('a', 'two-pointers')], [row('a', '', true, 0)])
    expect(groups.some((g) => g.pattern === '')).toBe(false)
    expect(groups.find((g) => g.pattern === null)?.problems[0]).toMatchObject({ slug: 'a', attempted: true })
  })
})
