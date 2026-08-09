import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEM_SLUG } from './context'

/**
 * Coding problems, addressed by their own slug and never by their path.
 *
 * A coding problem lives at `problems/<pattern>/<problem>/`, so **the path is a
 * spoiler**: the directory it sits in is the pattern, which is the single thing
 * the drill exists to test recall of. `.claude/commands/drill.md` says it
 * outright — "do not display its file path". `assertNoSpoilers` cannot help
 * here, because it guards what gets *read*, not what gets *shown*, and reading
 * the README is both necessary and safe.
 *
 * So this module is the only place that knows the mapping. Everything above it
 * — routes, prompts, the client — deals in bare slugs, and the pattern reaches
 * exactly one consumer on purpose: the interviewer, which needs it to give rung
 * 2 of the hint ladder and is told never to volunteer it.
 */

export interface CodingProblem {
  /** The problem's own directory name, e.g. `container-with-most-water`. */
  slug: string
  /** The pattern directory it lives under. A spoiler — see the module comment. */
  pattern: string
  /**
   * The tier from `meta.yaml`, or `'unrated'` when the file omits it or names
   * something unrecognised.
   *
   * Safe to show, unlike `pattern`: it says how hard the problem is, not what
   * the answer looks like. It is here because the set is 20-odd medium problems
   * and picking a warm-up out of an alphabetical list of slugs is guesswork —
   * and after five years away, opening with a warm-up is the point.
   */
  difficulty: Difficulty
}

/** Ordered easiest first, which is the order the picker groups them in. */
export const DIFFICULTIES = ['warmup', 'easy', 'medium', 'hard', 'unrated'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]

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
 * Just enough of a problem to locate its directory.
 *
 * Separate from `CodingProblem` so that resolving a path never requires a
 * difficulty: the test runner and the routes below build one of these from a
 * slug and a pattern lookup, and they have no business knowing the tier.
 */
export type ProblemLocation = Pick<CodingProblem, 'slug' | 'pattern'>

/** `problems/<pattern>/<problem>` for a resolved problem. Never shown to Andre. */
export function problemDir(problem: ProblemLocation): string {
  return `problems/${problem.pattern}/${problem.slug}`
}

/**
 * Every coding problem in the repo, slug and pattern, sorted by slug.
 *
 * A directory only counts as a problem if it holds a `README.md` — there is no
 * drill to run without a prompt, and listing one would offer a broken choice.
 */
export function listCodingProblems(root: string): CodingProblem[] {
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
export function findCodingProblem(root: string, slug: string): CodingProblem | null {
  if (!PROBLEM_SLUG.test(slug)) return null
  return listCodingProblems(root).find((problem) => problem.slug === slug) ?? null
}

/**
 * Strips anything that would name the pattern out of text bound for Andre.
 *
 * The belt to `listCodingProblems`'s braces. Test output is the one thing in this
 * track that is generated rather than authored — vitest prints the file path of
 * every suite it runs, and that path contains the pattern. Rather than trusting
 * every future formatter not to pass a path through, this runs over anything
 * derived from a problem's files on its way out.
 *
 * Deliberately narrow: it rewrites the `problems/<pattern>/` prefix and nothing
 * else, so it cannot silently mangle a candidate's own words.
 */
export function stripPatternPaths(text: string): string {
  return text.replace(/problems\/[a-z0-9-]+\//g, 'problems/')
}
