import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCodingProblem, problemDir } from './problems'

/**
 * Everything a browser needs to run a coding drill's suite client-side, for
 * `GET /api/coding/<slug>/exercise`.
 *
 * Three files: the stub the candidate starts from, the suite that grades it,
 * and the `test-utils/*` modules that suite actually imports. All three are
 * plain source — no path, no directory listing — because the browser cannot
 * be handed a filesystem, only files.
 */
export interface Exercise {
  stub: string
  test: string
  /** Keyed by the specifier the suite's own `import` uses, e.g. `../../../test-utils/random`. */
  utils: Record<string, string>
}

/**
 * The `test-utils` modules `solution.test.ts` names in its own imports.
 *
 * Every problem's suite imports a subset of three shared modules — 19 import
 * `random`, 4 `oracle`, 3 `sequence` — and it varies per problem. Shipping all
 * three regardless would work, but it would mean this module has to be
 * updated by hand every time a fourth `test-utils` module is added; reading
 * the suite's own imports means it never drifts from what the suite actually
 * needs. A regex rather than a full parser: the specifier is always a plain
 * string literal on an `import ... from '...'` line, and vitest itself would
 * refuse to run a suite whose imports do not look like that.
 */
function testUtilsImports(test: string): string[] {
  const specifiers = new Set<string>()
  const importRe = /from\s+['"]((?:\.\.\/)*test-utils\/([a-z]+))['"]/g
  for (const match of test.matchAll(importRe)) {
    specifiers.add(match[1]!)
  }
  return [...specifiers]
}

/**
 * Builds the exercise payload for a resolved coding problem, or `null` when
 * the slug names none.
 *
 * Reads `stub.ts`, never `solution.ts`. That is the one rule this function
 * exists to keep: `docs/superpowers/specs/2026-08-11-browser-editor-design.md`
 * records that on a deployed box `solution.ts` holds whatever the last person
 * left there, so seeding a browser workspace from it hands the next candidate
 * a worked answer — the file this function reads is spelled out once, right
 * here, rather than derived, so that mistake cannot be a one-word typo away.
 */
export function buildExercise(root: string, slug: string): Exercise | null {
  const problem = findCodingProblem(root, slug)
  if (problem === null) return null
  const dir = join(root, problemDir(problem))
  const stub = readFileSync(join(dir, 'stub.ts'), 'utf8')
  const test = readFileSync(join(dir, 'solution.test.ts'), 'utf8')
  const utils: Record<string, string> = {}
  for (const specifier of testUtilsImports(test)) {
    const name = specifier.slice(specifier.lastIndexOf('/') + 1)
    // `testUtilsImports` only ever matches `test-utils/<name>` where `<name>`
    // is `[a-z]+`, so `name` is never a path segment that could escape
    // `test-utils/` — there is nothing here for a hostile suite to exploit,
    // and every suite in the repo is authored, not client-supplied, anyway.
    utils[specifier] = readFileSync(join(root, 'test-utils', `${name}.ts`), 'utf8')
  }
  return { stub, test, utils }
}
