import { describe, expect, it } from 'vitest'
// The runner's own `expect`, under a name that cannot be confused with vitest's.
// This file asserts things *about* the shim, so both are in scope at once.
import { expect as shimExpect } from './expect'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { executeSuite, type Exercise } from './execute'
import { verdictForTimeout } from './runner'
import type { SuiteProgress } from './types'
import { stripSuiteComments } from '../../../suite-comments'

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
    const { failed } = await executeSuite(asExercise(pattern, slug))
    // Every `it` in the suite must fail, because a stub throws in all of them.
    // Asserting the count rather than "more than none" is the point: a suite
    // that died on import also reports a failure, and that is exactly the
    // outcome this has to tell apart from the suite having run.
    const declared = readFileSync(join(PROBLEMS, pattern, slug, 'solution.test.ts'), 'utf8')
    expect(failed).toHaveLength((declared.match(/\bit\(/g) ?? []).length)
  })

  /**
   * Comment stripping changes nothing about what a suite does.
   *
   * Running the suite in the browser means shipping `solution.test.ts` over the
   * wire, so its comments — which explain fixture construction, and have leaked
   * an approach once already — are removed before it is served. That is only
   * safe if it is provably inert, and "provably" here means all forty-two, not a
   * spot check: a stripper that quietly broke one suite would report a green
   * drill over code that never ran.
   *
   * Compared on failure *titles*, not just the count. A count alone would let a
   * suite lose one test and gain another unnoticed.
   */
  it.each(problems)('$pattern/$slug behaves identically with its comments removed', async ({ pattern, slug }) => {
    const exercise = asExercise(pattern, slug)
    const before = await executeSuite(exercise)
    const after = await executeSuite({ ...exercise, test: stripSuiteComments(exercise.test) })
    const names = (run: { failed: { suite: string; title: string }[] }) =>
      run.failed.map((f) => `${f.suite} > ${f.title}`)
    expect(names(after)).toEqual(names(before))
  })

  /**
   * And it removes something. A stripper that returned its input unchanged
   * would pass every assertion above while leaving the exposure exactly where it
   * was.
   */
  it('actually removes the comments, including the ones naming a pattern', () => {
    const stripped = problems.map(({ pattern, slug }) => ({
      pattern,
      slug,
      text: stripSuiteComments(asExercise(pattern, slug).test),
    }))
    // Four suites currently name their own pattern directory in a comment. None
    // may afterwards — and this is asserted per problem against its own pattern,
    // so a future suite that picks up the habit fails here.
    expect(stripped.filter((s) => s.text.includes(`/${s.pattern}/`)).map((s) => s.slug)).toEqual([])
    // And every suite got smaller, which is the crude check that the stripper
    // ran at all.
    for (const { pattern, slug, text } of stripped) {
      expect(`${pattern}/${slug}`).toBe(
        text.length < asExercise(pattern, slug).test.length ? `${pattern}/${slug}` : 'not stripped',
      )
    }
  })

  /**
   * The shim knows every matcher the suites actually use.
   *
   * This is the audit the browser runner rests on, turned into a test so it
   * cannot go stale the way it already did — the inventory was measured by hand
   * on 2026-08-13 and four problems landed afterwards, at which point "these are
   * the only matchers used" was a claim about a tree that no longer existed.
   *
   * The failure it prevents is the quiet kind. An unknown matcher is not a
   * helpful error: `expect(x).toMatchObject(...)` on an object that has no such
   * key throws a TypeError inside the `it`, which the runner records as one
   * failing test — indistinguishable from a wrong answer, and pointing the
   * candidate at their own code.
   *
   * The supported set is read off the shim itself rather than listed here. A
   * second list would be a second thing to update.
   */
  it('supports every matcher the authored suites reach for', () => {
    // Keyed by receiver, not just by name. `toThrow` exists on `.rejects` and
    // nowhere else, so a bare `expect(fn).toThrow(...)` is unsupported while
    // `await expect(p).rejects.toThrow(...)` is fine — and a check that could not
    // tell those apart would either miss the first or falsely flag the second.
    // It falsely flagged the second on its first run, which is how this got
    // written this way.
    const supported = new Set([
      ...Object.keys(shimExpect(0)),
      ...Object.keys(shimExpect(0).not),
      ...Object.keys(shimExpect(Promise.resolve()).rejects).map((name) => `rejects.${name}`),
    ])
    const used = new Map<string, string[]>()
    for (const { pattern, slug } of problems) {
      const src = readFileSync(join(PROBLEMS, pattern, slug, 'solution.test.ts'), 'utf8')
      for (const m of src.matchAll(/(\.rejects)?\.(to[A-Z][A-Za-z]*)\(/g)) {
        const name = m[1] ? `rejects.${m[2]!}` : m[2]!
        used.set(name, [...(used.get(name) ?? []), `${pattern}/${slug}`])
      }
    }
    // `toString` is a JS method rather than a matcher, and a suite is entitled
    // to call it on a value. Excluded by name because the pattern above cannot
    // tell the two apart.
    used.delete('toString')
    const missing = [...used].filter(([name]) => !supported.has(name))
    expect(missing.map(([name, where]) => `${name} — used by ${where.join(', ')}`)).toEqual([])
    // And the sweep found something, so an empty result means "all covered"
    // rather than "the regex matched nothing".
    expect(used.size).toBeGreaterThan(5)
  })

  /**
   * And the suites use no test-framework feature the runner does not implement.
   *
   * Same failure mode as an unknown matcher, one level up: a suite calling
   * `beforeEach` against a shim that has none registers its tests and then runs
   * them without their fixture, which is a green drill over code that was never
   * set up the way the author intended.
   */
  it('uses no framework feature the runner does not have', () => {
    const unsupported = /\b(beforeEach|afterEach|beforeAll|afterAll|it\.each|describe\.each|it\.only|it\.skip|vi\.)/
    const offenders = problems.filter(({ pattern, slug }) =>
      unsupported.test(readFileSync(join(PROBLEMS, pattern, slug, 'solution.test.ts'), 'utf8')),
    )
    expect(offenders.map((p) => `${p.pattern}/${p.slug}`)).toEqual([])
  })

  // The Worker is reused across runs in a session, so a stale registry would
  // re-report the previous drill's tests over the current one's code.
  it('does not carry one run\'s tests into the next', async () => {
    const first = asExercise(problems[0]!.pattern, problems[0]!.slug)
    await executeSuite(first)
    const again = await executeSuite(first)
    expect(again.failed).toHaveLength((first.test.match(/\bit\(/g) ?? []).length)
  })
})

/**
 * Progress reporting, through the module the Worker actually runs.
 *
 * `runner.ts` said the overrun case could not be measured because "no
 * brute-force implementations are committed to the repo". That is true of the
 * *problems* and it is not what this needs. What the classification depends on
 * is that `executeSuite` reports which test it is in, in order, with the
 * `describe` name attached — and that is checkable against a suite shaped like
 * a real one, without anything hanging.
 *
 * The hang itself is covered in `runner.test.ts`, against a Worker that reports
 * and then goes quiet, which is what a spinning test looks like from outside.
 * It is not reproduced here on purpose: a real `while (true)` cannot be
 * preempted in-process, and escaping it by throwing out of `runSuite` would
 * skip its `resetRegistry()` and leak registered tests into the 42 real suites
 * this file runs afterwards.
 */
describe('progress reporting', () => {
  const SUITE = `
    import { describe, it, expect } from 'vitest'
    import { slow } from './solution'
    describe('slow — correctness', () => {
      it('returns the right answer', () => { expect(slow(2)).toBe(4) })
    })
    describe('slow — cost', () => {
      it('stays under budget', () => { expect(1).toBe(2) })
    })
  `
  const SOLUTION = `export function slow(n) { return n * 2 }`

  it('names each test before it runs, with its suite', async () => {
    const seen: SuiteProgress[] = []
    await executeSuite({ test: SUITE, solution: SOLUTION, utils: {} }, (p) =>
      seen.push(structuredClone(p)),
    )
    const started = seen.filter((p) => p.running !== null).map((p) => p.running)
    expect(started).toEqual([
      { suite: 'slow — correctness', title: 'returns the right answer' },
      { suite: 'slow — cost', title: 'stays under budget' },
    ])
  })

  /**
   * And nothing is left in flight once a test settles. Without that clearing
   * report, a ceiling firing during the teardown after the last test would
   * name a test that had already passed as the one that hung.
   */
  it('clears the running test once it settles', async () => {
    const seen: SuiteProgress[] = []
    await executeSuite({ test: SUITE, solution: SOLUTION, utils: {} }, (p) =>
      seen.push(structuredClone(p)),
    )
    expect(seen.at(-1)?.running).toBeNull()
  })

  // The failures accumulate as they happen, which is what lets a timeout after
  // a correctness failure report the wrong answer instead of "your drill broke".
  it('carries failures that have already happened', async () => {
    const seen: SuiteProgress[] = []
    await executeSuite({ test: SUITE, solution: SOLUTION, utils: {} }, (p) =>
      seen.push(structuredClone(p)),
    )
    expect(seen.at(-1)?.failed).toEqual([
      { suite: 'slow — cost', title: 'stays under budget' },
    ])
  })

  // The verdict that a hung cost test produces, which is the point of it all.
  it('classifies a hung cost test as cost-red, not errored', () => {
    expect(
      verdictForTimeout(
        { running: { suite: 'slow — cost', title: 'stays under budget' }, failed: [] },
        30_000,
      ).kind,
    ).toBe('cost-red')
  })
})
