import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { transform } from 'sucrase'
import { describe as shimDescribe, expect as shimExpect, it as shimIt, resetRegistry, runSuite, toFailedTests } from './shim'

/**
 * The shim against every real suite in the repo.
 *
 * `shim.test.ts` proves the pieces work on miniature suites written to exercise
 * them. This proves the thing that actually matters: that all 42 authored
 * suites *run*. The failure this catches is a matcher or a syntax form nobody
 * inventoried — which does not throw a helpful error, it silently registers no
 * tests and reports a green drill over code that was never executed.
 *
 * Node's `fs` is used to find the suites; nothing it loads reaches the shim,
 * which stays free of `node:*` so it can run in a Worker.
 */

const ROOT = join(import.meta.dirname, '../../../..')
const PROBLEMS = join(ROOT, 'problems')

const toCjs = (src: string): string =>
  transform(src, { transforms: ['typescript', 'imports'] }).code

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
 * Run one problem's suite the way the Worker will.
 *
 * Seeded from `stub.ts`, never `solution.ts` — the same rule the exercise route
 * follows. Here it also keeps the test honest: a stub throws, so every suite
 * must report failures, and a suite reporting none has silently not run.
 */
async function runAgainstStub(pattern: string, slug: string): Promise<ReturnType<typeof toFailedTests>> {
  const dir = join(PROBLEMS, pattern, slug)
  const suiteSrc = readFileSync(join(dir, 'solution.test.ts'), 'utf8')
  const modules = new Map<string, unknown>()

  const req = (specifier: string): unknown => {
    if (specifier === 'vitest') {
      return { describe: shimDescribe, it: shimIt, expect: shimExpect, test: shimIt }
    }
    const mod = modules.get(specifier)
    if (mod === undefined) throw new Error(`unresolved specifier: ${specifier}`)
    return mod
  }

  const define = (specifier: string, src: string): void => {
    const module = { exports: {} as Record<string, unknown> }
    new Function('require', 'module', 'exports', toCjs(src))(req, module, module.exports)
    modules.set(specifier, module.exports)
  }

  for (const m of suiteSrc.matchAll(/from '([^']*test-utils\/([a-z]+))'/g)) {
    define(m[1]!, readFileSync(join(ROOT, 'test-utils', `${m[2]!}.ts`), 'utf8'))
  }
  define('./solution', readFileSync(join(dir, 'stub.ts'), 'utf8'))

  resetRegistry()
  new Function('require', 'module', 'exports', toCjs(suiteSrc))(req, { exports: {} }, {})
  return toFailedTests((await runSuite()) as never)
}

describe('every authored suite runs through the shim', () => {
  const problems = codingProblems()

  it('found the problems to check', () => {
    expect(problems.length).toBeGreaterThan(20)
  })

  it.each(problems)('$pattern/$slug executes and reports against a stub', async ({ pattern, slug }) => {
    const failed = await runAgainstStub(pattern, slug)
    // Every `it` in the suite must fail, because a stub throws in all of them.
    // Asserting the *count* rather than "more than none": a suite that blew up
    // on import would also report a failure or two, and that is exactly the
    // outcome this test has to tell apart from "the suite ran".
    const declared = readFileSync(join(PROBLEMS, pattern, slug, 'solution.test.ts'), 'utf8')
    expect(failed).toHaveLength((declared.match(/\bit\(/g) ?? []).length)
  })
})
