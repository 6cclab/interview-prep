import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCoachPrompt, coachPaths, codeCue, readWorkingFile } from './coach'
import { appendCoached, readCoachedProblems } from './coached'
import { allowedPaths, assertNoSpoilers, buildSystemPrompt } from './context'

const PROBLEM = { slug: 'two-sum-sorted', pattern: 'two-pointers' }

function seedRoot(over: { solution?: string; working?: string | null } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'coach-'))
  const problemDir = join(dir, 'problems', PROBLEM.pattern, PROBLEM.slug)
  mkdirSync(problemDir, { recursive: true })
  writeFileSync(join(problemDir, 'README.md'), '# Two sum\n\nFind the pair.\n', 'utf8')
  writeFileSync(join(problemDir, 'solution.test.ts'), "describe('x — correctness', () => {})", 'utf8')
  writeFileSync(join(problemDir, 'meta.yaml'), 'pattern: two-pointers\n', 'utf8')
  if (over.working !== null) {
    writeFileSync(join(problemDir, 'solution.ts'), over.working ?? 'export function twoSum() {}\n', 'utf8')
  }
  mkdirSync(join(dir, 'solutions', PROBLEM.pattern), { recursive: true })
  writeFileSync(
    join(dir, 'solutions', PROBLEM.pattern, `${PROBLEM.slug}.md`),
    over.solution ?? '# Worked answer\n\nWALK-INWARD-FROM-BOTH-ENDS\n',
    'utf8',
  )
  writeFileSync(join(dir, 'patterns.md'), '# Patterns\n\nPATTERNS-FILE-CONTENT\n', 'utf8')
  return dir
}

/**
 * The load-bearing pair of assertions for this whole track.
 *
 * Coaching reads the files a drill must never see. The tempting implementation
 * was a track exemption inside `assertNoSpoilers`, which would turn one absolute
 * rule into a conditional one. These two tests are what make the separate-door
 * design real rather than a claim in a comment: the guard still rejects every
 * path coaching reads, and the drill door still refuses to open for the track.
 */
describe('the spoiler gate is untouched by coaching', () => {
  it('still rejects every path a coach reads', () => {
    const paths = coachPaths(PROBLEM)
    expect(paths.length).toBeGreaterThan(0)
    // Not `expect(() => assertNoSpoilers(paths)).toThrow()` on the whole list:
    // that would pass if only one path were denied. Each spoiler is checked
    // individually.
    for (const path of ['solutions/two-pointers/two-sum-sorted.md', 'patterns.md']) {
      expect(paths).toContain(path)
      expect(() => assertNoSpoilers([path])).toThrow(/Refusing to read spoiler file/)
    }
  })

  it('refuses to build a drill allowlist for the coach track', () => {
    expect(() => allowedPaths('coach', PROBLEM.slug, PROBLEM.pattern)).toThrow(/does not use allowedPaths/)
  })

  it('refuses to build a drill system prompt for the coach track', () => {
    expect(() => buildSystemPrompt(seedRoot(), 'coach', PROBLEM.slug, PROBLEM.pattern)).toThrow(
      /does not use allowedPaths/,
    )
  })
})

describe('coachPaths', () => {
  it('includes the suite and meta.yaml, which a drill excludes', () => {
    const paths = coachPaths(PROBLEM)
    expect(paths).toContain('problems/two-pointers/two-sum-sorted/solution.test.ts')
    expect(paths).toContain('problems/two-pointers/two-sum-sorted/meta.yaml')
  })
})

describe('buildCoachPrompt', () => {
  const prompt = buildCoachPrompt(seedRoot(), PROBLEM)

  it('hands over the worked solution and the pattern notes', () => {
    expect(prompt).toContain('WALK-INWARD-FROM-BOTH-ENDS')
    expect(prompt).toContain('PATTERNS-FILE-CONTENT')
  })

  // The rationing is what a drill is for. Coaching after one is unrationed, and a
  // coach that withholds is an interviewer wearing the wrong label.
  it('tells the coach not to ration, score or time him', () => {
    expect(prompt).toMatch(/not interviewing him/)
    expect(prompt).toMatch(/no hint ladder/)
    expect(prompt).toMatch(/Answer directly/)
  })

  it('keeps the spoken constraints, including spelling complexity aloud', () => {
    expect(prompt).toMatch(/no markdown/)
    expect(prompt).toContain('"O of n", not "O(n)"')
  })

  // A missing worked solution would produce a coach with nothing to coach from —
  // an interviewer told it may talk freely, which is the worst of both modes.
  it('refuses to coach a problem with no worked solution', () => {
    const dir = seedRoot()
    const other = { slug: 'nonexistent', pattern: 'two-pointers' }
    expect(() => buildCoachPrompt(dir, other)).toThrow(/Cannot coach "nonexistent"/)
  })
})

describe('codeCue', () => {
  it('frames the file as state, never as something he said', () => {
    const cue = codeCue('const a = 1\n')
    expect(cue).toMatch(/^\[For you only, not spoken:/)
    expect(cue).toMatch(/not a message from him/)
    expect(cue).toContain('const a = 1')
  })

  // Silence here is the trap: a coach handed nothing starts describing code that
  // does not exist.
  it('says so when the file is empty or unreadable, rather than sending nothing', () => {
    expect(codeCue('')).toMatch(/currently empty/)
    expect(codeCue('   \n')).toMatch(/currently empty/)
    expect(codeCue(null)).toMatch(/could not be read/)
    expect(codeCue(null)).toMatch(/do not guess/i)
  })
})

describe('readWorkingFile', () => {
  it('reads solution.ts', () => {
    expect(readWorkingFile(seedRoot({ working: 'const x = 2\n' }), PROBLEM)).toBe('const x = 2\n')
  })

  it('returns null when there is no working file, which is a real state', () => {
    expect(readWorkingFile(seedRoot({ working: null }), PROBLEM)).toBeNull()
  })
})

/**
 * The coached marker.
 *
 * Its own file rather than a drill-log row, and that is the load-bearing choice:
 * the history screen leads with the cold-solve count, and a coaching session
 * counted as an attempt would inflate the one number it asks you to trust.
 */
describe('appendCoached', () => {
  it('creates the file with a preamble that says these are not attempts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coached-'))
    mkdirSync(join(dir, 'local'), { recursive: true })
    const rel = appendCoached(dir, { date: '2026-08-10', problem: 'two-sum-sorted', pattern: 'two-pointers', minutes: 22 })
    expect(rel).toBe('local/coached.md')
    const body = readFileSync(join(dir, 'local/coached.md'), 'utf8')
    expect(body).toMatch(/\*\*Not attempts\.\*\*/)
    expect(body).toMatch(/drill-log\.md/)
    expect(body).toContain('| 2026-08-10 | two-sum-sorted | two-pointers | 22 |')
  })

  it('appends without repeating the preamble', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coached-'))
    mkdirSync(join(dir, 'local'), { recursive: true })
    const row = { date: '2026-08-10', problem: 'a', pattern: 'p', minutes: 1 }
    appendCoached(dir, row)
    appendCoached(dir, { ...row, problem: 'b' })
    const body = readFileSync(join(dir, 'local/coached.md'), 'utf8')
    expect(body.match(/Not attempts/g)?.length).toBe(1)
    expect(readCoachedProblems(dir).sort()).toEqual(['a', 'b'])
  })

  // A transcript is the product of a session. Losing it to a failed bookkeeping
  // append would be the wrong trade.
  it('reports rather than throws when it cannot write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coached-'))
    // No `local/` directory, so the append cannot succeed.
    expect(appendCoached(dir, { date: '2026-08-10', problem: 'a', pattern: 'p', minutes: 1 })).toBeNull()
  })
})

describe('readCoachedProblems', () => {
  it('is empty when nothing has been coached', () => {
    expect(readCoachedProblems(mkdtempSync(join(tmpdir(), 'coached-')))).toEqual([])
  })

  it('skips the header rows rather than reading them as data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coached-'))
    mkdirSync(join(dir, 'local'), { recursive: true })
    appendCoached(dir, { date: '2026-08-10', problem: 'only-one', pattern: 'p', minutes: 3 })
    expect(readCoachedProblems(dir)).toEqual(['only-one'])
  })
})
