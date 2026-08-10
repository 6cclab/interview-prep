import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCoachPrompt, coachPaths, codeCue, readWorkingFile } from './coach'
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
