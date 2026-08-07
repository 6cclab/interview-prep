import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allowedPaths, assertNoSpoilers, buildSystemPrompt, competencyCoverage } from './context'

let root: string

function seed(relPath: string, body: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-context-'))
  seed('.claude/commands/mock.md', 'MOCK COMMAND')
  seed('.claude/commands/design.md', 'DESIGN COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n\n## Ambiguity\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
  seed('system-design/rate-limiter/README.md', 'PROMPT')
  seed('system-design/rate-limiter/rubric.md', 'RUBRIC')
  seed('system-design/rate-limiter/reference.md', 'THE ANSWER')
  seed('solutions/elimination/celebrity.md', 'THE ANSWER')
  seed('patterns.md', 'THE ANSWER')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('assertNoSpoilers', () => {
  it.each([
    'solutions/elimination/celebrity.md',
    'patterns.md',
    'system-design/rate-limiter/reference.md',
  ])('rejects %s', (denied) => {
    expect(() => assertNoSpoilers([denied])).toThrow(/spoiler/i)
  })

  it('allows the files a drill legitimately needs', () => {
    expect(() =>
      assertNoSpoilers(['behavioral/competencies.md', 'system-design/rate-limiter/rubric.md']),
    ).not.toThrow()
  })
})

describe('allowedPaths', () => {
  it('never returns a denied path for mock', () => {
    expect(() => assertNoSpoilers(allowedPaths('mock'))).not.toThrow()
  })

  it('never returns a denied path for design', () => {
    expect(() => assertNoSpoilers(allowedPaths('design', 'rate-limiter'))).not.toThrow()
  })

  it('scopes design context to the requested problem', () => {
    expect(allowedPaths('design', 'rate-limiter')).toContain(
      'system-design/rate-limiter/rubric.md',
    )
  })
})

describe('competencyCoverage', () => {
  it('lists every competency heading', () => {
    expect(competencyCoverage(root).all).toEqual(['Conflict', 'Ambiguity'])
  })

  it('reports none covered when there is no story bank yet', () => {
    expect(competencyCoverage(root).covered).toEqual([])
  })

  it('reports covered competencies from the story bank headings', () => {
    seed('local/stories.md', '## Conflict\n\nThe Redis migration story, in full.\n')
    expect(competencyCoverage(root).covered).toEqual(['Conflict'])
  })
})

describe('buildSystemPrompt', () => {
  it('includes the command prompt and the competency map', () => {
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).toContain('MOCK COMMAND')
    expect(prompt).toContain('Conflict')
  })

  it('never includes a story body, only the competency name', () => {
    seed('local/stories.md', '## Conflict\n\nThe Redis migration story, in full.\n')
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).toContain('Conflict')
    expect(prompt).not.toContain('Redis migration')
  })

  it('includes the rubric for a design drill', () => {
    expect(buildSystemPrompt(root, 'design', 'rate-limiter')).toContain('RUBRIC')
  })

  it('never includes the reference design', () => {
    expect(buildSystemPrompt(root, 'design', 'rate-limiter')).not.toContain('THE ANSWER')
  })
})
