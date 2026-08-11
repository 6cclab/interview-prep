import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allowedPaths, assertNoSpoilers, buildSystemPrompt, closingCue, competencyCoverage, timeCue } from './context'
import { splitTrailer } from './transcript'

let root: string

function seed(relPath: string, body: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-context-'))
  seed('prompts/mock.md', 'MOCK COMMAND')
  seed('prompts/design.md', 'DESIGN COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n\n## Ambiguity\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
  seed('system-design/rate-limiter/README.md', 'Design a rate limiter.')
  seed('system-design/rate-limiter/rubric.md', 'RUBRIC')
  seed('system-design/rate-limiter/reference.md', 'WORKED-DESIGN-SPOILER')
  seed('solutions/elimination/celebrity.md', 'THE ANSWER')
  seed('patterns.md', 'THE ANSWER')
  // The coding track needs its own command file and a problem README, so the
  // shared voice-mode assertions can cover all three tracks rather than two.
  seed('prompts/drill.md', 'DRILL COMMAND')
  seed('problems/two-pointers/container-with-most-water/README.md', 'Given heights, find the best pair.')
  // The debugging track: its command file and one exercise's bug report.
  seed('prompts/debug.md', 'DEBUG COMMAND')
  seed('debugging/loyalty-discount/README.md', '# Bug report: loyalty discount is inconsistent\n')
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
    seed('prompts/drill.md', 'DRILL COMMAND')
    seed('problems/two-pointers/container-with-most-water/README.md', 'Given n heights, find the largest container.')
    seed('problems/two-pointers/container-with-most-water/meta.yaml', 'pattern: two-pointers\ntitle: Container')
    seed('problems/two-pointers/container-with-most-water/solution.test.ts', 'FIXTURE-RATIONALE-COMMENTS')
  })

  it('reads the prompt and the protocol, and nothing else from the problem directory', () => {
    expect(allowedPaths('coding', 'container-with-most-water', 'two-pointers')).toEqual([
      'prompts/drill.md',
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

/**
 * One question per turn.
 *
 * A real design drill was ended in frustration, and the transcript says why: 15
 * of 24 interviewer turns asked two or more questions — several asked three or
 * four — and the interviewer then faulted him for the parts he had not answered.
 * In a spoken interview he cannot look back at what was said, so the second half
 * of a two-part question is simply gone. That measures short-term memory for
 * spoken lists, not engineering, and it is the opposite of what these drills are
 * for. The same defect showed up on the coding track, so the rule lives in the
 * shared voice-mode block.
 */
/** Each track's problem argument, since design and coding require one. */
const PROBLEM_FOR = { mock: undefined, design: 'rate-limiter', coding: 'container-with-most-water' } as const

describe('the spoken interviewer asks one question at a time', () => {
  it.each(['mock', 'design', 'coding'] as const)('instructs one question per turn on %s', (track) => {
    const prompt = buildSystemPrompt(root, track, PROBLEM_FOR[track], 'two-pointers')
    expect(prompt).toContain('one question per turn')
    // The reason, not just the rule: an instruction without its rationale is the
    // first thing a model discards under pressure.
    expect(prompt).toContain('cannot')
  })

  it('forbids faulting him for the half of a question he could not retain', () => {
    const prompt = buildSystemPrompt(root, 'design', 'rate-limiter')
    expect(prompt).toContain('Never')
    expect(prompt.toLowerCase()).toContain('did not answer')
  })
})

/**
 * Clock stewardship. The same session spent fourteen minutes of forty-five on a
 * single sub-point — idempotency keys — and the interviewer then told him not to
 * spend more of his clock on it. That was its clock to manage.
 */
describe('the timed interviewer owns the clock it is holding', () => {
  it.each(['design', 'coding'] as const)('tells %s to cut a stalled sub-question loose', (track) => {
    const prompt = buildSystemPrompt(root, track, PROBLEM_FOR[track], 'two-pointers')
    expect(prompt).toContain('four minutes')
    expect(prompt).toContain('move on')
  })

  // The behavioural track is deliberately untimed — "thinking time is the
  // exercise" — so a clock instruction there would be describing a clock that
  // does not exist.
  it('says nothing about a clock on the untimed behavioural track', () => {
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).not.toContain('four minutes')
  })
})

/**
 * The register, which was never stated and so was being inferred.
 *
 * A real drill on 2026-08-10 was conducted in the third person and spoken aloud
 * that way: "He said the text reads the same forwards and backwards ... Where do
 * those fit into what he just told me?" Everything else in the prompt refers to
 * Andre as "he" because it is written *about* the drill — only one line says
 * which voice to answer in, and until this it did not exist. Asserted on every
 * track, because it lives in the shared voice-mode block and the failure was not
 * track-specific.
 */
/**
 * The debugging track's allowlist.
 *
 * Two files, and the two omissions are the point: `src/**` holds the planted bug
 * ("you are running the exercise, not solving it"), and
 * `solutions/debugging/<exercise>.md` holds the worked answer, which the guard
 * denies for every track by the `^solutions/` rule with no exception for this one.
 */
describe('allowedPaths on the debug track', () => {
  it('is the command file and the bug report, and nothing else', () => {
    expect(allowedPaths('debug', 'loyalty-discount')).toEqual([
      'prompts/debug.md',
      'debugging/loyalty-discount/README.md',
    ])
  })

  it('names no source file and no suite', () => {
    const paths = allowedPaths('debug', 'loyalty-discount')
    expect(paths.some((path) => path.includes('/src/'))).toBe(false)
    expect(paths.some((path) => path.endsWith('.test.ts'))).toBe(false)
  })

  it('needs an exercise name', () => {
    expect(() => allowedPaths('debug')).toThrow(/needs a problem name/)
  })

  it('validates the exercise name like every other path segment', () => {
    expect(() => allowedPaths('debug', '../../solutions')).toThrow(/Invalid problem name/)
  })

  // The worked answer, denied without the track having to remember to exclude it.
  it('is still refused by the guard if a caller ever adds the worked answer', () => {
    expect(() => assertNoSpoilers(['solutions/debugging/loyalty-discount.md'])).toThrow(/spoiler/i)
  })
})

describe('the spoken register', () => {
  it.each([
    ['mock', undefined, undefined],
    ['design', 'rate-limiter', undefined],
    ['coding', 'container-with-most-water', 'two-pointers'],
    ['debug', 'loyalty-discount', undefined],
  ] as const)('tells the %s interviewer to address him in the second person', (track, problem, pattern) => {
    const prompt = buildSystemPrompt(root, track, problem, pattern)
    expect(prompt).toMatch(/Speak to him directly, in the second person/)
    expect(prompt).toMatch(/say "you"/)
    expect(prompt).toMatch(/never describe what he\s+said as though reporting it to someone else/)
    // The closing verdict was the worst offender: it read as a report filed
    // about him rather than something said to him.
    expect(prompt).toMatch(/closing\s+verdict, which he hears/)
  })
})

/**
 * The closing cue, and the timeout it must not invent.
 *
 * A real debugging drill ended at 14:48 of a forty-five minute budget and the
 * interviewer opened its verdict with "You ran out of time before you actually
 * touched any code". He had pressed End. The cue said he ended the session, but
 * the surrounding prompt frames the closing as the moment time expires and every
 * turn carries a time check — so the model narrated a timeout, which changed what
 * the grade meant: it excused the missing fix as a clock problem rather than a
 * stop.
 */
describe('closingCue', () => {
  it('says the clock has not run out, and forbids blaming one', () => {
    const cue = closingCue()
    expect(cue).toMatch(/clock has NOT run out/)
    expect(cue).toMatch(/Do not say he ran out of time/)
    expect(cue).toMatch(/do not excuse anything unfinished as a timing problem/)
  })

  it('is an aside, like every other cue', () => {
    expect(closingCue()).toMatch(/^\[For you only:/)
    expect(closingCue()).toMatch(/\]$/)
  })
})

/**
 * Two rules the debugging interviewer broke in a real drill, now stated.
 *
 * It volunteered a causal theory — "is there any async work already in flight from
 * before the switch" — having been shown the bug report and nothing else, and it
 * refused a question about the *shape* of the exercise ("where is the render
 * call?") as though the answer were part of the puzzle. There is no call site: the
 * two test files are the only entry points in any of these exercises. That refusal
 * cost the last third of a fifteen-minute session.
 */
describe('what the debugging interviewer may and may not say', () => {
  const prompt = (): string => buildSystemPrompt(root, 'debug', 'loyalty-discount')

  it('forbids a theory about the cause, including one phrased as a question', () => {
    expect(prompt()).toMatch(/Never offer a theory about the cause, including as a question/)
    expect(prompt()).toMatch(/a guess phrased as "have you considered whether\.\.\." is the most expensive/)
    expect(prompt()).toMatch(/Do not supply candidates/)
  })

  // The second thing a real drill read as an incomplete exercise: an id from the
  // bug report that is not in the fixture. It is usually the condition under test —
  // `entitlements-gate`'s third test in each suite is "when the customer
  // entitlements cannot be resolved", and the customer from the report is
  // deliberately absent from the data. The interviewer must be able to say how to
  // read that without saying what it means.
  it('tells it that an absent fixture id is a state, without confirming what it means', () => {
    const text = prompt()
    expect(text).toMatch(/the fixtures are the whole world/)
    expect(text).toMatch(/an\s+absent id is a state the code is being asked to handle/)
    expect(text).toMatch(/do not confirm\s+or deny what it means/)
  })

  it('tells it to answer plainly that the tests are the only entry points', () => {
    const text = prompt()
    expect(text).toMatch(/the two test files are the only entry points/)
    expect(text).toMatch(/the tests are the\s+callers/)
    expect(text).toMatch(/Refusing that/)
  })
})
