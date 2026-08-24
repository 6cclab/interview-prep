import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEM_SLUG, assertNoSpoilers } from './context'
import {
  DIFFICULTIES,
  type CodingProblem,
  type Difficulty,
  type DocumentKind,
  type ProblemLocation,
  type ProblemSource,
} from './problems'

/**
 * The problem set as it exists on disk: `problems/<pattern>/<problem>/`.
 *
 * This is today's code, moved rather than rewritten — it was the whole body of
 * `problems.ts` before the seam. It stays the only implementation that knows
 * about directories, which is the point of separating it: a deployed instance
 * serves problems out of Postgres and has no `problems/` tree to walk, while a
 * local run has no database and should need none.
 *
 * `root` stays in the signature even though a database implementation has no use
 * for one. It is not vestigial here: every test in this repo builds a temporary
 * `problems/` tree and points at it, and a module-level singleton resolved at
 * import time would take that away.
 */

/**
 * The `difficulty:` line from a problem's `meta.yaml`.
 *
 * A regex rather than a YAML parser, and a deliberately narrow one: this reads a
 * single scalar off a file whose only other consumer is a human. An unreadable
 * or unrecognised file is `'unrated'` and never a throw — a malformed `meta.yaml`
 * must not be able to empty the problem picker.
 */
function readDifficulty(dir: string): Difficulty {
  let text: string
  try {
    text = readFileSync(join(dir, 'meta.yaml'), 'utf8')
  } catch {
    return 'unrated'
  }
  const found = /^difficulty:[ \t]*([a-z]+)[ \t]*$/im.exec(text)?.[1]
  return DIFFICULTIES.includes(found as Difficulty) ? (found as Difficulty) : 'unrated'
}

/**
 * Every coding problem in the repo, slug and pattern, sorted by slug.
 *
 * A directory only counts as a problem if it holds a `README.md` — there is no
 * drill to run without a prompt, and listing one would offer a broken choice.
 */
export function listFromDisk(root: string): CodingProblem[] {
  const base = join(root, 'problems')
  if (!existsSync(base)) return []
  const found: CodingProblem[] = []
  for (const pattern of readdirSync(base, { withFileTypes: true })) {
    if (!pattern.isDirectory() || !PROBLEM_SLUG.test(pattern.name)) continue
    for (const slug of readdirSync(join(base, pattern.name), { withFileTypes: true })) {
      if (!slug.isDirectory() || !PROBLEM_SLUG.test(slug.name)) continue
      const dir = join(base, pattern.name, slug.name)
      if (!existsSync(join(dir, 'README.md'))) continue
      found.push({ slug: slug.name, pattern: pattern.name, difficulty: readDifficulty(dir) })
    }
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * The problem with this slug, or `null` if there is none.
 *
 * Resolves by scanning rather than by building a path out of the input, so a
 * hostile slug cannot name a directory: the only paths this can ever return are
 * ones already found on disk. The slug guard is still applied first, because
 * defence that depends on a later step being correct is not defence.
 */
export function findOnDisk(root: string, slug: string): CodingProblem | null {
  if (!PROBLEM_SLUG.test(slug)) return null
  return listFromDisk(root).find((problem) => problem.slug === slug) ?? null
}

/**
 * Which file on disk each servable document kind is.
 *
 * `stub` is `stub.ts` and `test` is `solution.test.ts`; neither is
 * `solution.ts`, and this table is the one place that decides so. Spelled out
 * rather than derived, because the mistake worth making impossible here is a
 * one-word typo that seeds a candidate's browser workspace from the worked
 * answer — which on a shared box is whatever the last person left there.
 */
const DOCUMENT_FILES: Record<DocumentKind, string> = {
  readme: 'README.md',
  stub: 'stub.ts',
  test: 'solution.test.ts',
}

/**
 * One of a problem's servable files, read from its directory.
 *
 * `assertNoSpoilers` still runs even though every path here is built from a
 * fixed table and a directory that was resolved by scanning. That is the point:
 * a guard that only runs where the author already believes it is unnecessary
 * catches nothing, and this is the last place a path exists before it becomes
 * bytes on a wire.
 */
function documentFromDisk(root: string, problem: ProblemLocation, kind: DocumentKind): string | null {
  const relPath = `problems/${problem.pattern}/${problem.slug}/${DOCUMENT_FILES[kind]}`
  assertNoSpoilers([relPath])
  const full = join(root, relPath)
  if (!existsSync(full)) return null
  return readFileSync(full, 'utf8')
}

export const fsProblems: ProblemSource = {
  list: listFromDisk,
  find: findOnDisk,
  document: documentFromDisk,
}
