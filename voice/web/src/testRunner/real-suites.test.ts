import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { executeSuite, type Exercise } from './execute'

/**
 * `executeSuite` against every real suite in the repo.
 *
 * `shim.test.ts` proves the pieces work on miniature suites written to
 * exercise them. This proves the thing that actually matters: that all 42
 * authored suites *run*. The failure it catches is a matcher or a syntax form
 * nobody inventoried — which does not raise a helpful error, it silently
 * registers no tests and reports a green drill over code that never ran.
 *
 * It calls the same `executeSuite` the Worker calls, rather than a copy of the
 * logic. A test that reimplements the thing under test is evidence about the
 * reimplementation.
 *
 * Node's `fs` is used here to find the suites on disk; nothing it loads
 * reaches `executeSuite`, which stays free of `node:*` so it runs in a Worker.
 */

const ROOT = join(import.meta.dirname, '../../../..')
const PROBLEMS = join(ROOT, 'problems')

function codingProblems(): { pattern: string; slug: string }[] {
  const found: { pattern: string; slug: string }[] = []
  for (const pattern of readdirSync(PROBLEMS)) {
    const patternDir = join(PROBLEMS, pattern)
    if (!statSync(patternDir).isDirectory()) continue
    for (const slug of readdirSync(patternDir)) {
      if (statSync(join(patternDir, slug)).isDirectory()) found.push({ pattern, slug })
    }
  }
  return found
}

/**
 * One problem as the exercise route would serve it.
 *
 * Seeded from `stub.ts`, never `solution.ts` — the same rule the route
 * follows, and here it also keeps the test honest: a stub throws in every
 * test, so the expected failure count is knowable.
 */
function asExercise(pattern: string, slug: string): Exercise {
  const dir = join(PROBLEMS, pattern, slug)
  const test = readFileSync(join(dir, 'solution.test.ts'), 'utf8')
  const utils: Record<string, string> = {}
  for (const m of test.matchAll(/from '([^']*test-utils\/([a-z]+))'/g)) {
    utils[m[1]!] = readFileSync(join(ROOT, 'test-utils', `${m[2]!}.ts`), 'utf8')
  }
  return { test, utils, solution: readFileSync(join(dir, 'stub.ts'), 'utf8') }
}

describe('every authored suite runs through the browser runner', () => {
  const problems = codingProblems()

  it('found the problems to check', () => {
    expect(problems.length).toBeGreaterThan(20)
  })

  it.each(problems)('$pattern/$slug executes and reports against a stub', async ({ pattern, slug }) => {
    const failed = await executeSuite(asExercise(pattern, slug))
    // Every `it` in the suite must fail, because a stub throws in all of them.
    // Asserting the count rather than "more than none" is the point: a suite
    // that died on import also reports a failure, and that is exactly the
    // outcome this has to tell apart from the suite having run.
    const declared = readFileSync(join(PROBLEMS, pattern, slug, 'solution.test.ts'), 'utf8')
    expect(failed).toHaveLength((declared.match(/\bit\(/g) ?? []).length)
  })

  // The Worker is reused across runs in a session, so a stale registry would
  // re-report the previous drill's tests over the current one's code.
  it('does not carry one run\'s tests into the next', async () => {
    const first = asExercise(problems[0]!.pattern, problems[0]!.slug)
    await executeSuite(first)
    const again = await executeSuite(first)
    expect(again).toHaveLength((first.test.match(/\bit\(/g) ?? []).length)
  })
})
