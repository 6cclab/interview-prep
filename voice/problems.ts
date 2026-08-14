import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEM_SLUG } from './context'

/**
 * Coding problems, addressed by their own slug and never by their path.
 *
 * A coding problem lives at `problems/<pattern>/<problem>/`, so **the path is a
 * spoiler**: the directory it sits in is the pattern, which is the single thing
 * the drill exists to test recall of. `prompts/drill.md` says it
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

/** One company lead from `meta.yaml`'s `companies:` list. Never the pattern. */
export interface Company {
  name: string
  confidence: string
}

/** `CodingProblem` plus the two fields `GET /api/problems/coding/detail` needs. */
export type CodingProblemDetail = CodingProblem & {
  title: string
  companies: Company[]
}

const TITLE_LINE = /^title:[ \t]*(.*)$/m

/**
 * The `title:` line from a problem's `meta.yaml`, or `fallback` when there is
 * none.
 *
 * `fallback` is a parameter rather than a constant inside the function because
 * the picker has nothing better than the slug to show if a problem's title is
 * missing, and that fallback is the caller's problem to choose, not this
 * reader's — same separation `readDifficulty` keeps by returning `'unrated'`
 * rather than guessing.
 */
function readTitle(dir: string, fallback: string): string {
  let text: string
  try {
    text = readFileSync(join(dir, 'meta.yaml'), 'utf8')
  } catch {
    return fallback
  }
  const raw = TITLE_LINE.exec(text)?.[1]?.trim()
  return raw ? raw : fallback
}

/**
 * The `companies:` list from a problem's `meta.yaml` — name and confidence
 * only, never `source` or `date`, which sometimes carry an internal note about
 * how the lead was reconstructed and are not fit for the wire.
 *
 * A second single-key regex parser, not a nested extension of
 * `scripts/drill-select.ts`'s `readBlockField`: that helper reads one scalar
 * out of one named block, and `companies:` is a *list* of blocks with no name
 * to match on. So each entry is carved out by splitting on its own `- name:`
 * marker — the one line every entry is guaranteed to start with — and the two
 * fields wanted are read out of the resulting chunk the same line-anchored way
 * as everywhere else in this file. `companies: []` (the documented shape for
 * "no lead") is not a parse failure: the block regex only matches a nested
 * list, so an inline empty array falls through to the same empty result as a
 * `companies:` key that is absent entirely.
 */
function readCompanies(dir: string): Company[] {
  let text: string
  try {
    text = readFileSync(join(dir, 'meta.yaml'), 'utf8')
  } catch {
    return []
  }
  const block = /^companies:[ \t]*\n((?:[ \t]+.*\n?)*)/m.exec(text)?.[1] ?? ''
  const entries = block.split(/(?=^[ \t]*-[ \t]*name:)/m).filter((chunk) => chunk.trim() !== '')
  const companies: Company[] = []
  for (const entry of entries) {
    const name = /name:[ \t]*(.*)$/m.exec(entry)?.[1]?.trim()
    if (!name) continue
    const confidence = /^[ \t]+confidence:[ \t]*(.*)$/m.exec(entry)?.[1]?.trim()
    companies.push({ name, confidence: confidence || 'unrated' })
  }
  return companies
}

/**
 * Every coding problem with the fields the detail picker shows — title and
 * companies alongside the slug and tier `listCodingProblems` already reads.
 *
 * Deliberately still returns `pattern` on every entry, same as
 * `listCodingProblems`: this stays a reader, and a reader that quietly drops a
 * field depending on who might be looking is the kind of conditional safety
 * gate `voice/coach.ts` warns leaks. The route this feeds is what strips it
 * before the response is serialised — see `GET /api/problems/coding/detail`.
 */
export function listCodingProblemDetails(root: string): CodingProblemDetail[] {
  const base = join(root, 'problems')
  return listCodingProblems(root).map((problem) => {
    const dir = join(base, problem.pattern, problem.slug)
    return { ...problem, title: readTitle(dir, problem.slug), companies: readCompanies(dir) }
  })
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
