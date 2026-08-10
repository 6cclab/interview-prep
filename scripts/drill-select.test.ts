import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HistoryRow } from '../voice/drill-log'
import type { CodingProblem } from '../voice/problems'
import { formatClock, formatLogRow, readAuthored, resolveTarget, rungFor, selectByRust } from './drill-select'

function problem(slug: string, pattern = 'two-pointers'): CodingProblem {
  return { slug, pattern, title: slug, difficulty: 'easy' } as CodingProblem
}

function row(over: Partial<HistoryRow> & { problem: string }): HistoryRow {
  return {
    date: '2026-08-01',
    pattern: null,
    solved: true,
    hints: 0,
    elapsedMs: 600_000,
    note: '',
    ...over,
  } as HistoryRow
}

function withMeta(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'drill-select-'))
  writeFileSync(join(dir, 'meta.yaml'), contents, 'utf8')
  return dir
}

describe('readAuthored', () => {
  it('reads the nudge, the approach and the complexity', () => {
    const dir = withMeta(`pattern: two-pointers
hints:
  nudge: Which end can you rule out, and why?
  approach: Walk inward from both ends.
complexity:
  time: O(n)
  space: O(1)
`)
    expect(readAuthored(dir)).toEqual({
      hints: { nudge: 'Which end can you rule out, and why?', approach: 'Walk inward from both ends.' },
      complexity: { time: 'O(n)', space: 'O(1)' },
    })
  })

  // The nested match is the point: a top-level key of the same name must not be
  // picked up as if it were inside the block.
  it('does not mistake a top-level key for a nested one', () => {
    const dir = withMeta(`pattern: dp-1d
time: not the complexity
nudge: not the hint
complexity:
  space: O(1)
`)
    const authored = readAuthored(dir)
    expect(authored.complexity.time).toBeUndefined()
    expect(authored.complexity.space).toBe('O(1)')
    expect(authored.hints.nudge).toBeUndefined()
  })

  it('unquotes a value an author had to quote', () => {
    const dir = withMeta(`complexity:
  time: "O(n): one pass"
`)
    expect(readAuthored(dir).complexity.time).toBe('O(n): one pass')
  })

  it('returns empties for a problem with nothing authored, and for a missing file', () => {
    expect(readAuthored(withMeta('pattern: intervals\n'))).toEqual({ hints: {}, complexity: {} })
    expect(readAuthored('/nonexistent/problem/dir')).toEqual({ hints: {}, complexity: {} })
  })
})

describe('rungFor', () => {
  const solutionPath = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'drill-solutions-'))
    mkdirSync(join(dir, 'two-pointers'), { recursive: true })
    const path = join(dir, 'two-pointers', 'two-sum-sorted.md')
    writeFileSync(path, '# Worked answer\n', 'utf8')
    return path
  })()

  // Half the ladder needs no authoring and never did — that is the finding this
  // whole runner rests on.
  it('serves rung 2 from the pattern name with nothing authored', () => {
    const got = rungFor(2, { pattern: 'monotonic-stack', hints: {}, solutionPath })
    expect(got.text).toBe('monotonic-stack')
    expect(got.missing).toBeUndefined()
  })

  it('serves rung 4 from the solutions file with nothing authored', () => {
    const got = rungFor(4, { pattern: 'two-pointers', hints: {}, solutionPath })
    expect(got.file).toBe(solutionPath)
    expect(got.missing).toBeUndefined()
  })

  it('serves rungs 1 and 3 from meta.yaml when authored', () => {
    const hints = { nudge: 'A question.', approach: 'An approach.' }
    expect(rungFor(1, { pattern: 'p', hints, solutionPath }).text).toBe('A question.')
    expect(rungFor(3, { pattern: 'p', hints, solutionPath }).text).toBe('An approach.')
  })

  // Saying so beats silently skipping to the next rung, which would hand over
  // more than one rung's worth of help for one request.
  it('reports an unauthored rung rather than falling through to the next', () => {
    const one = rungFor(1, { pattern: 'p', hints: {}, solutionPath })
    expect(one.text).toBeUndefined()
    expect(one.missing).toMatch(/hints\.nudge/)
    expect(rungFor(3, { pattern: 'p', hints: {}, solutionPath }).missing).toMatch(/hints\.approach/)
  })

  it('reports a missing worked solution', () => {
    const got = rungFor(4, { pattern: 'p', hints: {}, solutionPath: '/nope/missing.md' })
    expect(got.file).toBeUndefined()
    expect(got.missing).toMatch(/No worked solution/)
  })

  it('has exactly four rungs', () => {
    expect(rungFor(5, { pattern: 'p', hints: {}, solutionPath }).missing).toMatch(/four/)
    expect(rungFor(0, { pattern: 'p', hints: {}, solutionPath }).missing).toMatch(/four/)
  })
})

describe('selectByRust', () => {
  const set = [problem('a'), problem('b'), problem('c')]

  it('prefers a problem never attempted', () => {
    const picked = selectByRust(set, [row({ problem: 'a' })])
    expect(picked?.problem.slug).toBe('b')
    expect(picked?.why).toBe('never attempted')
  })

  // A solve that needed four hints is not evidence of recall. The log records
  // the rung precisely so this distinction can be made.
  it('prefers a problem attempted but never solved cold', () => {
    const picked = selectByRust(set, [
      row({ problem: 'a' }),
      row({ problem: 'b', solved: true, hints: 3 }),
      row({ problem: 'c' }),
    ])
    expect(picked?.problem.slug).toBe('b')
    expect(picked?.why).toBe('never solved cold')
  })

  it('counts an unsolved attempt as never solved cold', () => {
    const picked = selectByRust(set, [
      row({ problem: 'a' }),
      row({ problem: 'b' }),
      row({ problem: 'c', solved: false, hints: 2 }),
    ])
    expect(picked?.problem.slug).toBe('c')
  })

  it('falls back to the longest since a cold solve', () => {
    const picked = selectByRust(set, [
      row({ problem: 'a', date: '2026-07-01' }),
      row({ problem: 'b', date: '2026-05-02' }),
      row({ problem: 'c', date: '2026-06-03' }),
    ])
    expect(picked?.problem.slug).toBe('b')
    expect(picked?.why).toMatch(/2026-05-02/)
  })

  // A pick you cannot reproduce is a pick you cannot compare against.
  it('is deterministic for the same log', () => {
    const rows = [row({ problem: 'a', date: '2026-07-01' }), row({ problem: 'b', date: '2026-07-01' })]
    const first = selectByRust(set, rows)
    const second = selectByRust(set, rows)
    expect(first?.problem.slug).toBe(second?.problem.slug)
  })

  it('handles an empty set and an empty log', () => {
    expect(selectByRust([], [])).toBeNull()
    expect(selectByRust(set, [])?.problem.slug).toBe('a')
  })
})

describe('resolveTarget', () => {
  const set = [problem('two-sum-sorted'), problem('valid-palindrome'), problem('climbing-stairs', 'dp-1d')]

  it('matches a slug exactly', () => {
    expect(resolveTarget(set, 'valid-palindrome').map((p) => p.slug)).toEqual(['valid-palindrome'])
  })

  it('matches every problem under a pattern', () => {
    expect(resolveTarget(set, 'two-pointers').map((p) => p.slug)).toEqual(['two-sum-sorted', 'valid-palindrome'])
  })

  it('returns nothing for an unknown target', () => {
    expect(resolveTarget(set, 'nope')).toEqual([])
  })
})

describe('formatClock', () => {
  it('is mm:ss under an hour and h:mm:ss past one', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(61_000)).toBe('01:01')
    expect(formatClock(24 * 60_000 + 18_000)).toBe('24:18')
    expect(formatClock(3_661_000)).toBe('1:01:01')
  })

  it('never goes negative', () => {
    expect(formatClock(-5000)).toBe('00:00')
  })
})

describe('formatLogRow', () => {
  const base = {
    date: '2026-08-10',
    problem: 'contains-duplicate',
    pattern: 'hashmap-counting',
    solved: true,
    hints: 3,
    elapsedMs: 24 * 60_000 + 18_000,
  }

  it('writes the row the log table expects', () => {
    expect(formatLogRow({ ...base, note: 'add-before-check ordering' })).toBe(
      '| 2026-08-10 | contains-duplicate | hashmap-counting | yes | 3 | 24:18 | add-before-check ordering |',
    )
  })

  // `voice/drill-log.ts` honours `\|`. Deleting a character out of someone's own
  // note is worse than the raw table looking odd.
  it('escapes a pipe in the note rather than dropping it', () => {
    expect(formatLogRow({ ...base, note: 'used a | there' })).toContain('used a \\| there')
  })

  it('flattens newlines and fills an empty note', () => {
    expect(formatLogRow({ ...base, note: 'one\ntwo' })).toContain('one two')
    expect(formatLogRow({ ...base, note: '   ' })).toContain('| — |')
  })

  it('records an unsolved attempt as no', () => {
    expect(formatLogRow({ ...base, solved: false, note: 'gave up' })).toContain('| no | 3 |')
  })
})
