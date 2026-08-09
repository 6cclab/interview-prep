import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allowedPaths, assertNoSpoilers, buildSystemPrompt, competencyCoverage, timeCue } from './context'
import { splitTrailer } from './transcript'

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
  seed('system-design/rate-limiter/README.md', 'Design a rate limiter.')
  seed('system-design/rate-limiter/rubric.md', 'RUBRIC')
  seed('system-design/rate-limiter/reference.md', 'WORKED-DESIGN-SPOILER')
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

  it('rejects a traversal path that resolves into solutions/', () => {
    expect(() =>
      assertNoSpoilers(['system-design/../solutions/elimination/README.md']),
    ).toThrow(/spoiler/i)
  })

  it('rejects an absolute path', () => {
    expect(() => assertNoSpoilers(['/etc/passwd'])).toThrow(/spoiler/i)
  })

  it('rejects PATTERNS.MD regardless of case', () => {
    expect(() => assertNoSpoilers(['PATTERNS.MD'])).toThrow(/spoiler/i)
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

  it('rejects a problem name that attempts path traversal', () => {
    expect(() => allowedPaths('design', '../solutions/elimination')).toThrow()
  })

  it('still accepts an ordinary lowercase-and-hyphen problem slug', () => {
    expect(() => allowedPaths('design', 'rate-limiter')).not.toThrow()
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

  it('throws a clear error for a nonexistent problem', () => {
    expect(() => buildSystemPrompt(root, 'design', 'no-such-problem')).toThrow(
      /no-such-problem/,
    )
  })

  it('redirects the mock story-log step and names every field it expects back', () => {
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).toContain('story-log')
    for (const field of ['competency', 'story', 'worked', 'fix']) {
      expect(prompt).toContain(`${field}:`)
    }
  })

  it('never mentions story-log for a design drill — only mock ends in a trailer', () => {
    const prompt = buildSystemPrompt(root, 'design', 'rate-limiter')
    expect(prompt).not.toContain('story-log')
  })

  it('emits a trailer example that the real splitTrailer parses into a full StoryLog (producer/consumer contract)', () => {
    // This closes the loop: it does not just grep for the string "story-log",
    // it runs the prompt's own example fence through the real parser. If the
    // prompt's fence marker, field names, or key: value shape ever drifts
    // from what splitTrailer expects, this fails — even though each half
    // still looks fine read on its own.
    const prompt = buildSystemPrompt(root, 'mock')
    const { log } = splitTrailer(prompt)
    expect(log).not.toBeNull()
    expect(log!.competency.length).toBeGreaterThan(0)
    expect(log!.story.length).toBeGreaterThan(0)
    expect(log!.worked.length).toBeGreaterThan(0)
    expect(log!.fix.length).toBeGreaterThan(0)
  })
})

describe('timeCue', () => {
  it('reports the whole budget at the start', () => {
    expect(timeCue(0)).toContain('45 minutes of the 45 remain')
  })

  it('rounds up, so it never claims zero minutes while time remains', () => {
    // One second left is still "1 minute" — a cue saying "0 minutes remain"
    // reads as the deadline, which is a different instruction entirely.
    expect(timeCue(45 * 60 * 1000 - 1000)).toContain('1 minute of the 45 remain')
    expect(timeCue(45 * 60 * 1000 - 1000)).not.toContain('minutes')
  })

  it('says plainly that time is up, so "at time, stop" has an unambiguous trigger', () => {
    expect(timeCue(45 * 60 * 1000)).toContain('time is up')
    expect(timeCue(60 * 60 * 1000)).toContain('time is up')
  })

  it('honours a custom budget', () => {
    expect(timeCue(0, 30 * 60 * 1000)).toContain('30 minutes of the 30 remain')
    expect(timeCue(20 * 60 * 1000, 30 * 60 * 1000)).toContain('10 minutes of the 30 remain')
  })

  // The cue arrives in the `user` slot, where everything else is Andre
  // speaking. Marking it as an aside to the interviewer is the only thing
  // standing between the drill and an interviewer reading the clock out loud as
  // though it were part of the answer.
  it('marks itself as an instruction to the interviewer, not as speech', () => {
    for (const elapsed of [0, 35 * 60 * 1000, 45 * 60 * 1000]) {
      expect(timeCue(elapsed)).toMatch(/^\[Time check, for you only:/)
      expect(timeCue(elapsed)).toMatch(/\]$/)
    }
  })
})

describe('buildSystemPrompt on the design track', () => {
  // The mock track shipped with exactly this bug: <voice-mode> never replaced
  // the command file's "write to a file" step, so the step was unfollowable and
  // silently skipped while every test still passed.
  it('replaces design.md step 6 file write with speaking the score, and explains the clock', () => {
    const prompt = buildSystemPrompt(root, 'design', 'rate-limiter')
    expect(prompt).toContain('cannot write files')
    expect(prompt).toContain('deliver the score out')
    expect(prompt).toContain('time check')
    // The story-log trailer is the mock track's mechanism and has no business here.
    expect(prompt).not.toContain('story-log')
  })

  it('never includes the reference design', () => {
    const prompt = buildSystemPrompt(root, 'design', 'rate-limiter')
    expect(prompt).toContain('Design a rate limiter')
    expect(prompt).not.toContain('WORKED-DESIGN-SPOILER')
  })
})

describe('buildSystemPrompt on the coding track', () => {
  beforeEach(() => {
    seed('.claude/commands/drill.md', 'DRILL COMMAND')
    seed('problems/two-pointers/container-with-most-water/README.md', 'Given n heights, find the largest container.')
    seed('problems/two-pointers/container-with-most-water/meta.yaml', 'pattern: two-pointers\ntitle: Container')
    seed('problems/two-pointers/container-with-most-water/solution.test.ts', 'FIXTURE-RATIONALE-COMMENTS')
  })

  it('reads the prompt and the protocol, and nothing else from the problem directory', () => {
    expect(allowedPaths('coding', 'container-with-most-water', 'two-pointers')).toEqual([
      '.claude/commands/drill.md',
      'problems/two-pointers/container-with-most-water/README.md',
    ])
  })

  it('never reads meta.yaml or the test file', () => {
    const prompt = buildSystemPrompt(root, 'coding', 'container-with-most-water', 'two-pointers')
    expect(prompt).toContain('largest container')
    // meta.yaml names the pattern in a field, and the test file's comments have
    // leaked an approach once before.
    expect(prompt).not.toContain('title: Container')
    expect(prompt).not.toContain('FIXTURE-RATIONALE-COMMENTS')
  })

  // The interviewer is the one consumer that needs the pattern: rung 2 of the
  // hint ladder is "the pattern name, and nothing else", and an interviewer that
  // does not know the answer cannot ration it.
  it('tells the interviewer the pattern, once and explicitly', () => {
    const prompt = buildSystemPrompt(root, 'coding', 'container-with-most-water', 'two-pointers')
    expect(prompt).toContain('<pattern>two-pointers</pattern>')
  })

  it('replaces every drill.md step that needs a tool it does not have', () => {
    // Whitespace-normalised: the prompt is hard-wrapped for readability, so a
    // phrase can straddle a newline. The wrapping is presentational and asserting
    // through it would make the test break on a reflow rather than on a change of
    // meaning.
    const prompt = buildSystemPrompt(root, 'coding', 'container-with-most-water', 'two-pointers').replace(/\s+/g, ' ')
    expect(prompt).toMatch(/no clock/i)
    expect(prompt).toMatch(/he runs them/i) // step 7, the tests
    expect(prompt).toMatch(/cannot write it/i) // the drill log
    expect(prompt).toMatch(/do not read it out/i) // step 2, the README
    // The behaviour most easily lost out loud: silence is him typing.
    expect(prompt).toMatch(/long silences are him working/i)
    // The other tracks' mechanisms have no business here.
    expect(prompt).not.toContain('story-log')
  })

  it('refuses a coding drill with no resolved pattern', () => {
    expect(() => allowedPaths('coding', 'container-with-most-water')).toThrow(/resolved pattern/i)
  })

  it.each(['../elimination', '/etc', 'Two-Pointers', ''])('refuses the pattern %j', (pattern) => {
    expect(() => allowedPaths('coding', 'container-with-most-water', pattern)).toThrow()
  })
})
