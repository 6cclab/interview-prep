import { transform } from 'sucrase'
import { describe, it, resetRegistry, runSuite } from './registry'
import { expect } from './expect'
import { toFailedTests } from './shim'
import type { FailedTest } from './types'

/**
 * Everything one drill needs to run, as text. Exactly what
 * `GET /api/coding/<slug>/exercise` returns, plus whatever the candidate has
 * typed into the editor.
 */
export interface Exercise {
  /** The suite, verbatim from `solution.test.ts`. */
  test: string
  /** The candidate's code — the editor buffer, seeded from `stub.ts`. */
  solution: string
  /** `test-utils` modules, keyed by the specifier the suite imports them by. */
  utils: Record<string, string>
}

/**
 * TypeScript to CommonJS.
 *
 * The `imports` transform is the load-bearing half. Type stripping alone
 * leaves ESM `import` statements, which a Worker cannot resolve without an
 * import map or a bundler; converting to `require` turns module resolution
 * into a lookup this file controls, and the suites only ever reference three
 * things — `vitest`, a `test-utils` module, and `./solution`.
 *
 * sucrase rather than esbuild-wasm: 1.14MB against 14.5MB, for a job that is
 * only stripping types. Nothing here needs a bundler or JSX.
 */
function toCjs(src: string): string {
  return transform(src, { transforms: ['typescript', 'imports'] }).code
}

/**
 * Run one drill's suite against the candidate's code and report which tests
 * failed.
 *
 * Deliberately free of `node:*` and of the DOM: this is the module the Worker
 * runs, and it is also the module the Node test exercises against all 42 real
 * suites. Keeping the execution logic here rather than in the Worker shell is
 * what makes that test evidence about shipped code rather than about a copy
 * of it.
 *
 * Returns names only. `toFailedTests` drops the matcher messages, per the rule
 * `voice/drill-tests.ts` states: a message quotes the fixture it compared
 * against, and the fixture is part of the answer.
 */
export async function executeSuite(exercise: Exercise): Promise<FailedTest[]> {
  const modules = new Map<string, unknown>()

  const require = (specifier: string): unknown => {
    // The shim stands in for vitest. `test` is aliased to `it` even though no
    // suite currently uses it, because the cost is one property and the
    // failure it prevents — a suite silently registering nothing — is silent.
    if (specifier === 'vitest') return { describe, it, test: it, expect }
    const mod = modules.get(specifier)
    if (mod === undefined) throw new Error(`unresolved import: ${specifier}`)
    return mod
  }

  const define = (specifier: string, src: string): void => {
    const module = { exports: {} as Record<string, unknown> }
    new Function('require', 'module', 'exports', toCjs(src))(require, module, module.exports)
    modules.set(specifier, module.exports)
  }

  for (const [specifier, src] of Object.entries(exercise.utils)) define(specifier, src)
  define('./solution', exercise.solution)

  // Registration is global to the module, so a second run in the same Worker
  // would otherwise re-report the first run's tests.
  resetRegistry()
  new Function('require', 'module', 'exports', toCjs(exercise.test))(require, { exports: {} }, {})

  return toFailedTests(await runSuite())
}
