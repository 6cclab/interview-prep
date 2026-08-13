import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyFailures,
  failedTestsFromJson,
  verdictCue,
  type DrillVerdict,
  type FailedTest,
} from './drill-verdict'

/** A failing test as vitest reports one: a suite name and a title, separately. */
function failing(suite: string, title = 'a case'): FailedTest {
  return { suite, title }
}

describe('classifyFailures', () => {
  it('is green with nothing failing', () => {
    expect(classifyFailures([])).toEqual({ kind: 'green' })
  })

  it('calls a correctness failure what it is: a wrong answer', () => {
    expect(classifyFailures([failing('maxArea — correctness', 'handles all-equal heights')])).toEqual({
      kind: 'correctness-red',
      failed: ['maxArea — correctness > handles all-equal heights'],
    })
  })

  it.each([
    'maxArea — scale',
    'findCelebrity — budget',
    'findCelebrity — access budget',
    'findCelebrity — randomised trials',
  ])('calls a failure in %j a cost failure: a right answer that costs too much', (suite) => {
    expect(classifyFailures([failing(suite)])).toEqual({ kind: 'cost-red', failed: [`${suite} > a case`] })
  })

  // The distinction drill.md insists on: a correctness failure alongside a cost
  // failure is a wrong answer, not a working brute force. Reporting "your answer
  // is right and too expensive" to someone whose answer is wrong is the specific
  // wrong lesson that section exists to prevent.
  it('reports correctness-red when both kinds fail, and names only the correctness ones', () => {
    expect(
      classifyFailures([
        failing('maxArea — scale', 'big input'),
        failing('maxArea — correctness', 'canonical container'),
      ]),
    ).toEqual({
      kind: 'correctness-red',
      failed: ['maxArea — correctness > canonical container'],
    })
  })

  it('is case-insensitive about the marker', () => {
    expect(classifyFailures([failing('maxArea — CORRECTNESS')]).kind).toBe('correctness-red')
  })

  // The marker belongs to the `describe`. A test title mentioning the word must
  // not flip a cost failure into a wrong answer — and this is only checkable at
  // all because suite and title are kept apart rather than pre-joined.
  it('does not treat a mention of the word in a test title as the marker', () => {
    expect(classifyFailures([failing('maxArea — scale', 'correctness is not the point')]).kind).toBe('cost-red')
    expect(classifyFailures([failing('maxArea — scale', 'a case — correctness aside')]).kind).toBe('cost-red')
  })
})

// The classification above is only as good as the convention it reads. This is
// the test that keeps it honest: it checks the real problem set, so a new drill
// authored with a different suite name is caught here rather than by silently
// misreporting a wrong answer as a working brute force during a live drill.
describe('the suite-naming convention classifyFailures depends on', () => {
  it('every problem has a correctness suite, and every other suite is a cost suite', () => {
    const base = join(process.cwd(), 'problems')
    const patterns = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())
    let checked = 0
    for (const pattern of patterns) {
      for (const slug of readdirSync(join(base, pattern.name), { withFileTypes: true })) {
        if (!slug.isDirectory()) continue
        const file = join(base, pattern.name, slug.name, 'solution.test.ts')
        let source: string
        try {
          source = readFileSync(file, 'utf8')
        } catch {
          continue
        }
        const suites = [...source.matchAll(/^describe\((['"`])(.*?)\1/gm)].map((m) => m[2]!)
        expect(suites.length, `${slug.name} has no describe blocks`).toBeGreaterThan(0)
        expect(
          suites.some((name) => /—\s*correctness\b/i.test(name)),
          `${slug.name} has no "— correctness" suite, so a wrong answer would be reported as a working brute force`,
        ).toBe(true)
        checked++
      }
    }
    // Guards against the loop finding nothing and passing vacuously.
    expect(checked).toBeGreaterThanOrEqual(20)
  })
})

describe('failedTestsFromJson', () => {
  // The shape below is a real vitest report's, verified against one: the suite is
  // in `ancestorTitles` and `fullName` is the two joined by a plain space —
  // "maxArea — correctness finds the canonical container". Reading `fullName` and
  // splitting on ` > ` looked right and could never have worked.
  const json = JSON.stringify({
    testResults: [
      {
        assertionResults: [
          {
            status: 'passed',
            title: 'canonical',
            ancestorTitles: ['maxArea — correctness'],
            fullName: 'maxArea — correctness canonical',
          },
          {
            status: 'failed',
            title: 'big input',
            ancestorTitles: ['maxArea — scale'],
            fullName: 'maxArea — scale big input',
          },
        ],
      },
      {
        assertionResults: [
          {
            status: 'failed',
            title: 'zero height',
            ancestorTitles: ['maxArea — correctness'],
            fullName: 'maxArea — correctness zero height',
          },
        ],
      },
    ],
  })

  it('takes the failing tests, and only the failing ones, suite kept apart from title', () => {
    expect(failedTestsFromJson(json)).toEqual([
      { suite: 'maxArea — scale', title: 'big input' },
      { suite: 'maxArea — correctness', title: 'zero height' },
    ])
  })

  it('joins nested describes so the whole suite path is available to match on', () => {
    const nested = JSON.stringify({
      testResults: [
        {
          assertionResults: [
            { status: 'failed', title: 'x', ancestorTitles: ['outer', 'maxArea — correctness'] },
          ],
        },
      ],
    })
    expect(failedTestsFromJson(nested)).toEqual([{ suite: 'outer > maxArea — correctness', title: 'x' }])
  })

  it('survives a report with no results at all', () => {
    expect(failedTestsFromJson('{}')).toEqual([])
  })
})

describe('verdictCue', () => {
  it('asks for complexity on green, per drill.md', () => {
    expect(verdictCue({ kind: 'green' })).toMatch(/complexity/i)
  })

  it('marks itself as an aside to the interviewer, not as speech', () => {
    const verdicts: DrillVerdict[] = [
      { kind: 'green' },
      { kind: 'correctness-red', failed: ['a'] },
      { kind: 'cost-red', failed: ['a'] },
      { kind: 'errored', message: 'x' },
    ]
    for (const verdict of verdicts) {
      expect(verdictCue(verdict)).toMatch(/^\[Test result, for you only:/)
      expect(verdictCue(verdict)).toMatch(/\]$/)
    }
  })

  // The cue carries the meaning, not just the fact — drill.md requires the
  // distinction be made explicitly every time, and the interviewer cannot make
  // it from a bare list of test names.
  it('tells the interviewer a cost failure is a right answer, and not a failed attempt', () => {
    const cue = verdictCue({ kind: 'cost-red', failed: ['maxArea — scale > big'] })
    expect(cue).toMatch(/right/i)
    expect(cue).toMatch(/brute force/i)
    expect(cue).toMatch(/not.*failed attempt/i)
  })

  it('tells the interviewer a correctness failure is a wrong answer', () => {
    const cue = verdictCue({ kind: 'correctness-red', failed: ['maxArea — correctness > x'] })
    expect(cue).toMatch(/wrong/i)
    expect(cue).toMatch(/keeps going/i)
  })
})

// The property the whole extraction exists for: a browser bundle must never pull
// in child_process (or any other node:* builtin) through this module. Enforced
// rather than assumed, because "pure" silently rotting back into "imports fs"
// is exactly the regression a deploy-time bundle error would catch too late.
describe('node-free', () => {
  it('imports nothing from a node: builtin', () => {
    const source = readFileSync(join(__dirname, 'drill-verdict.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]node:/)
  })
})
