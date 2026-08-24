import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCodingProblem, problemDir } from './problems'

/**
 * Reading and writing a coding drill's working file.
 *
 * Writes the REAL `problems/<pattern>/<slug>/solution.ts` rather than a
 * session-scoped copy, and that is the load-bearing choice: `Run tests`
 * already runs vitest against that directory, `pnpm reset` already archives
 * that file to `local/attempts/`, and `/review` already debriefs from it. A
 * temp copy would have meant teaching all three about temp copies.
 *
 * Every function here takes a bare slug. A coding problem's path is its
 * pattern and the pattern is the answer, so `problems.ts` stays the only
 * module that turns one into the other, and no value returned from here
 * contains the resolved path.
 */

/**
 * A content hash, used to detect that someone else wrote the file since the
 * editor loaded it.
 *
 * Content rather than mtime: mtime has filesystem-dependent resolution, and two
 * writes inside one tick would compare equal — which is exactly the case the
 * guard exists for. Truncated to 16 hex characters; this detects accidental
 * concurrent edits, it is not a security boundary.
 */
export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export interface SolutionFile {
  text: string
  version: string
}

/** The current contents, or null when the slug resolves to no problem. */
export function readSolution(root: string, slug: string): SolutionFile | null {
  const problem = findCodingProblem(root, slug)
  if (problem === null) return null
  const text = readFileSync(join(root, problemDir(problem), 'solution.ts'), 'utf8')
  return { text, version: versionOf(text) }
}

export type WriteOutcome = 'ok' | 'stale' | 'missing'

/**
 * Write only if the file still holds what the caller last saw.
 *
 * `'stale'` is not an error condition to be retried around — it means a second
 * tab or the candidate's own editor has the file, and the client must keep the
 * typed buffer and say so. Silently winning that race destroys work.
 */
export function writeSolution(
  root: string,
  slug: string,
  text: string,
  expected: string,
): WriteOutcome {
  const problem = findCodingProblem(root, slug)
  if (problem === null) return 'missing'
  const path = join(root, problemDir(problem), 'solution.ts')
  if (versionOf(readFileSync(path, 'utf8')) !== expected) return 'stale'
  writeFileSync(path, text)
  return 'ok'
}
