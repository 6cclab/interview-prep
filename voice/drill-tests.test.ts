import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyFailures,
  failedTestsFromJson,
  parseCostMeasurement,
  runDrillTests,
  verdictCue,
  type DrillVerdict,
  type FailedTest,
} from './drill-tests'

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

describe('runDrillTests', () => {
  const problem = { slug: 'container-with-most-water', pattern: 'two-pointers' }

  /** A report in vitest's real shape — see failedTestsFromJson's fixture. */
  function jsonFor(failed: { suite: string; title: string }[]): string {
    return JSON.stringify({
      testResults: [
        {
          assertionResults: failed.map(({ suite, title }) => ({
            status: 'failed',
            title,
            ancestorTitles: [suite],
          })),
        },
      ],
    })
  }

  /** A stand-in vitest: writes the report it would have written, and nothing else. */
  function reports(failed: { suite: string; title: string }[]) {
    return async (_args: string[], _cwd: string, reportPath: string) => {
      writeFileSync(reportPath, jsonFor(failed))
    }
  }

  it('runs the resolved test file, not a substring filter on the slug', async () => {
    let seen: string[] = []
    await runDrillTests({
      root: '/repo',
      problem,
      runner: async (args, _cwd, reportPath) => {
        seen = args
        writeFileSync(reportPath, jsonFor([]))
      },
    })
    // A bare slug would let `vitest run` match unrelated suites elsewhere in the
    // repo and fold them into this drill's verdict.
    expect(seen).toContain('problems/two-pointers/container-with-most-water/solution.test.ts')
    expect(seen).toContain('--reporter=json')
  })

  it('classifies a failing run', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: reports([{ suite: 'maxArea — scale', title: 'big input' }]),
    })
    expect(verdict.kind).toBe('cost-red')
  })

  // A failing suite exits non-zero, so execFile rejects — but vitest has still
  // written its report. Treating that as "could not run" would turn every red
  // drill into an error and lose the distinction entirely.
  it('reads the report off a non-zero exit rather than calling it an error', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      // A failing suite: vitest writes its report and *then* exits non-zero.
      runner: async (_args, _cwd, reportPath) => {
        writeFileSync(reportPath, jsonFor([{ suite: 'maxArea — correctness', title: 'canonical' }]))
        throw new Error('Command failed')
      },
    })
    expect(verdict).toEqual({
      kind: 'correctness-red',
      failed: ['maxArea — correctness > canonical'],
    })
  })

  it('reports a genuine failure to run as errored, not as a red drill', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async () => {
        throw new Error('spawn npx ENOENT')
      },
    })
    expect(verdict.kind).toBe('errored')
  })

  it('treats unparseable output as a solution that would not compile', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async (_args, _cwd, reportPath) => {
        writeFileSync(reportPath, 'Transform failed with 1 error')
      },
    })
    expect(verdict.kind).toBe('errored')
    if (verdict.kind === 'errored') expect(verdict.message).toMatch(/syntax or type error/i)
  })

  // The reason the report goes to a file at all: stdout is shared with whatever
  // the solution logs, and a mid-drill `console.log({ n: 3 })` is entirely
  // normal. Scanning stdout for the payload broke on exactly this.
  it('is unaffected by console output the solution printed', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async (args, _cwd, reportPath) => {
        expect(args.some((a) => a.startsWith('--outputFile='))).toBe(true)
        writeFileSync(reportPath, jsonFor([]))
      },
    })
    expect(verdict.kind).toBe('green')
  })

  // The pattern is the answer, and vitest prints the path of every suite it
  // runs. Anything derived from test output is scrubbed on the way out.
  it('never lets the pattern out through a failing test name', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: reports([
        { suite: 'problems/two-pointers/container-with-most-water/solution.test.ts > maxArea — scale', title: 'x' },
      ]),
    })
    expect(JSON.stringify(verdict)).not.toContain('two-pointers')
  })

  it('never lets the pattern out through a run error either', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async () => {
        throw new Error('ENOENT: problems/two-pointers/container-with-most-water/solution.ts')
      },
    })
    expect(JSON.stringify(verdict)).not.toContain('two-pointers')
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

/**
 * The cost measurement: two real numbers, read off the assertion that failed.
 *
 * This is the data behind the over-budget verdict's two bars, and the reason
 * that verdict can honestly call itself a measurement. The numbers are never
 * derived or estimated — every cost fixture in `problems/` times itself with
 * `performance.now()` and asserts `toBeLessThan(budget)`, so a failure states
 * both the actual and the ceiling.
 */
describe('parseCostMeasurement', () => {
  // Verbatim from a real vitest JSON report, captured rather than assumed.
  const REAL = [
    'AssertionError: expected 41203.482 to be less than 5000',
    '    at /Users/someone/projects/interview-prep/problems/heap-top-k/kth-largest-stream/solution.test.ts:4:19',
    '    at file:///…/node_modules/.pnpm/@vitest+runner@3.2.7/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11',
  ].join('\n')

  it('reads both numbers out of a real budget failure', () => {
    expect(parseCostMeasurement([REAL])).toEqual({ actualMs: 41203.482, budgetMs: 5000 })
  })

  /**
   * The message this is read out of begins with a stack trace whose first frame
   * is the suite's absolute path — which contains `problems/<pattern>/`, i.e.
   * the answer. Returning two numbers rather than the text is what makes that
   * unreachable instead of dependent on a caller remembering to scrub it.
   */
  it('carries no text out of the message, so the pattern path cannot travel', () => {
    const measurement = parseCostMeasurement([REAL])
    expect(JSON.stringify(measurement)).not.toContain('heap-top-k')
    expect(JSON.stringify(measurement)).not.toContain('problems/')
    expect(Object.keys(measurement!).sort()).toEqual(['actualMs', 'budgetMs'])
  })

  it('is null for a failure that is not a budget assertion', () => {
    expect(parseCostMeasurement(['AssertionError: expected 3 to be 4'])).toBeNull()
    expect(parseCostMeasurement([])).toBeNull()
    expect(parseCostMeasurement(undefined)).toBeNull()
  })

  it('refuses a zero or negative budget rather than dividing by it', () => {
    expect(parseCostMeasurement(['expected 12 to be less than 0'])).toBeNull()
  })
})

describe('classifyFailures with a measurement', () => {
  const withCost = (suite: string, actualMs: number, budgetMs: number): FailedTest => ({
    suite,
    title: 'a case',
    cost: { actualMs, budgetMs },
  })

  it('attaches the measurement to a cost-red', () => {
    const verdict = classifyFailures([withCost('kth — scale', 41203, 5000)])
    expect(verdict).toEqual({
      kind: 'cost-red',
      failed: ['kth — scale > a case'],
      measurement: { actualMs: 41203, budgetMs: 5000 },
    })
  })

  /**
   * By ratio, not by absolute milliseconds. A 40s answer against a 5s budget is
   * 8x; a 3s answer against a 100ms budget is 30x. The second is the more
   * serious result even though it is the smaller number, and picking the larger
   * number would report the milder overrun.
   */
  it('picks the worst overrun by ratio, not by absolute time', () => {
    const verdict = classifyFailures([withCost('a — scale', 40_000, 5000), withCost('b — budget', 3000, 100)])
    expect(verdict).toMatchObject({ measurement: { actualMs: 3000, budgetMs: 100 } })
  })

  it('still classifies a cost failure that carries no measurement', () => {
    const verdict = classifyFailures([failing('kth — scale')])
    expect(verdict.kind).toBe('cost-red')
    expect(verdict).not.toHaveProperty('measurement')
  })

  /**
   * The cardinal sin, restated at the data layer: a correctness failure is a
   * wrong answer and has no budget to measure. Attaching one would invite the
   * screen to draw cost bars on it and read as "right, but slow".
   */
  it('never attaches a measurement to a wrong answer', () => {
    const verdict = classifyFailures([withCost('kth — correctness', 41203, 5000)])
    expect(verdict.kind).toBe('correctness-red')
    expect(verdict).not.toHaveProperty('measurement')
  })
})
