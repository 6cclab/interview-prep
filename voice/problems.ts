import { fsProblems } from './problems-fs'

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
 *
 * ---
 *
 * **The seam.** Where the problems come from is chosen once, at startup, by
 * `VOICE_MODE`. A local run walks `problems/` on disk; a deployed instance reads
 * a Postgres serving copy and has no such tree. Both satisfy `ProblemSource`,
 * and every caller above this module keeps talking to the same four functions,
 * which is why this split is a no-op today and additive tomorrow.
 *
 * Selected once rather than per call, and never auto-detected: a server that
 * guesses which store it is talking to is a server that can be wrong about it
 * halfway through a drill.
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
 * Just enough of a problem to locate its directory.
 *
 * Separate from `CodingProblem` so that resolving a path never requires a
 * difficulty: the test runner and the routes below build one of these from a
 * slug and a pattern lookup, and they have no business knowing the tier.
 */
export type ProblemLocation = Pick<CodingProblem, 'slug' | 'pattern'>

/**
 * Where a mode gets its problems from.
 *
 * **Synchronous, and that is a decision rather than an oversight.** Problem
 * definitions are read-only serving data: the repo always wins, ingestion is an
 * explicit `pnpm ingest` on deploy, and there are forty-odd of them. A database
 * implementation loads the set once at startup and answers out of memory, so
 * nothing here has to become a promise and no call site above has to learn
 * about one. The data that genuinely *is* per-request and mutable — a
 * candidate's solution buffer — lives in `solution-file.ts`, not here, and is
 * free to be async without dragging the picker with it.
 */
export interface ProblemSource {
  list(root: string): CodingProblem[]
  find(root: string, slug: string): CodingProblem | null
  document(root: string, problem: ProblemLocation, kind: DocumentKind): string | null
}

/**
 * The three files of a coding problem that are ever served to a browser.
 *
 * `solution` is deliberately absent from this union and not merely unlisted:
 * there is no value of `DocumentKind` that names it, so a route cannot ask for
 * it by getting a string wrong. Reaching the worked answer takes a different
 * function through a different door — see `coachPaths`.
 *
 * `test` is on the list because the browser test runner needs the suite in
 * order to grade anything client-side. That is new exposure and it is known:
 * four suites currently name their own pattern directory in a comment, which is
 * what the comment-stripping step exists for.
 */
export type DocumentKind = 'readme' | 'stub' | 'test'

/** Which store this process talks to. Chosen once, at startup. */
export type VoiceMode = 'local' | 'deployed'

const MODES: readonly VoiceMode[] = ['local', 'deployed']

/**
 * `VOICE_MODE`, defaulting to `local`.
 *
 * Defaults rather than requiring the variable, because the local drill is the
 * daily loop and must keep working with no setup at all — no database, no auth,
 * no environment. An unrecognised value is a throw, not a silent fall back to
 * local: `VOICE_MODE=production` quietly serving a developer's `problems/` tree
 * is precisely the failure this is meant to make impossible.
 */
export function resolveMode(env: NodeJS.ProcessEnv = process.env): VoiceMode {
  const raw = env.VOICE_MODE
  if (raw === undefined || raw === '') return 'local'
  if (!MODES.includes(raw as VoiceMode)) {
    throw new Error(`VOICE_MODE must be one of ${MODES.join(', ')} — got "${raw}".`)
  }
  return raw as VoiceMode
}

/**
 * What `deployed` mode gets until something installs the real thing.
 *
 * A stub that throws rather than an absent case that falls through to the
 * filesystem. `VOICE_MODE=deployed` on a machine where startup did not complete
 * should fail on the first request with a sentence naming the reason, not serve
 * whatever `problems/` happens to be in the image.
 */
const NOT_INSTALLED = 'VOICE_MODE=deployed serves problems from Postgres, which startup has not installed.'

const notInstalled: ProblemSource = {
  list() {
    throw new Error(NOT_INSTALLED)
  },
  find() {
    throw new Error(NOT_INSTALLED)
  },
  document() {
    throw new Error(NOT_INSTALLED)
  },
}

/**
 * Hand this process the source to serve from. Called once, from `main()`.
 *
 * Injected rather than imported, because importing it here would put `pg` — and
 * the whole `voice/db` tree — on the local path. Every coding drill in the repo
 * imports this module transitively, and none of them should load a database
 * driver to find out where a README lives. `main()` reaches the Postgres source
 * through a dynamic `import()` under `mode === 'deployed'` and passes it in, so
 * a local run never resolves the module at all.
 */
export function installProblemSource(source: ProblemSource): void {
  selected = source
}

/**
 * Resolved on first use rather than at import time.
 *
 * Half this repo's tests import this module, and a throw during import would
 * surface as an unrelated module failing to load rather than as a bad
 * `VOICE_MODE`. Cached after the first call so the choice cannot change under a
 * running process.
 */
let selected: ProblemSource | undefined

export function problemSource(): ProblemSource {
  // `problems-fs` imports `DIFFICULTIES` back out of this module, so the two
  // form a cycle. It is safe in the shape they have: the only runtime value
  // crossing each way is a module-level `const`, and neither is read until a
  // function is called, by which point both modules have finished evaluating.
  // Everything else that crosses is a type, which is erased.
  selected ??= resolveMode() === 'local' ? fsProblems : notInstalled
  return selected
}

/** Test seam: forget the cached choice so a test can exercise the other mode. */
export function resetProblemSource(): void {
  selected = undefined
}

/** `problems/<pattern>/<problem>` for a resolved problem. Never shown to Andre. */
export function problemDir(problem: ProblemLocation): string {
  return `problems/${problem.pattern}/${problem.slug}`
}

/**
 * Every coding problem, slug and pattern, sorted by slug.
 *
 * The public shape is unchanged from before the seam, deliberately: six modules
 * call these two functions and none of them should have to know which store
 * answered.
 */
export function listCodingProblems(root: string): CodingProblem[] {
  return problemSource().list(root)
}

/** The problem with this slug, or `null` if there is none. */
export function findCodingProblem(root: string, slug: string): CodingProblem | null {
  return problemSource().find(root, slug)
}

/**
 * One of a coding problem's three servable files, or `null` when it has none.
 *
 * Behind the seam for the same reason the list is: a deployed instance has no
 * `problems/` tree it should be reading. It may well have one — the container
 * image carries the repo — and that is exactly the problem. The database is the
 * serving copy that `pnpm ingest` controls, and a route reading the image's disk
 * instead would quietly serve whatever commit was baked in rather than what was
 * ingested, with nothing anywhere saying the two had diverged.
 */
export function codingDocument(root: string, problem: ProblemLocation, kind: DocumentKind): string | null {
  return problemSource().document(root, problem, kind)
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
 *
 * **Not vestigial, and not to be deleted with the filesystem source.** Local
 * mode still spawns vitest against a real path, so this is load-bearing there
 * for as long as that is true. It is only unreachable on the deployed path,
 * where no filename ever enters the picture.
 */
export function stripPatternPaths(text: string): string {
  return text.replace(/problems\/[a-z0-9-]+\//g, 'problems/')
}
