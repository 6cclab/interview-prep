import { withPrivileged } from './db/pool'
import type { CodingProblem, Difficulty, ProblemSource } from './problems'
import { DIFFICULTIES } from './problems'

/**
 * The problem set as it exists in Postgres, for `VOICE_MODE=deployed`.
 *
 * **Loaded once, at startup, into memory.** `ProblemSource` is synchronous, and
 * that is the decision `problems.ts` documents rather than an oversight: problem
 * definitions are read-only serving data, there are forty-odd of them, and
 * ingestion is an explicit `pnpm ingest` on deploy. Making the picker async to
 * re-fetch an unchanging list on every keystroke would buy nothing and would
 * push a promise into six call sites that have no use for one.
 *
 * The consequence is worth stating plainly: **a fresh `pnpm ingest` does not
 * reach a running server.** The process must restart to see it. On a deploy that
 * is free — the ingest runs alongside a rollout — and the alternative is a
 * cache-invalidation problem in exchange for nothing.
 *
 * `root` is accepted and ignored. It stays in the signature because the
 * filesystem source genuinely needs it and because every test in this repo
 * points at a temporary tree; a database has no directory to point at.
 */

/**
 * Read as `app_privileged`, and only here.
 *
 * `CodingProblem.pattern` is a spoiler, and `app_runtime` cannot see it —
 * `schema.sql` revokes the base table. But `pattern` is genuinely needed by two
 * callers above this module: hint rung 2 is the pattern name, and the coach
 * track builds a prompt out of the worked solution. The filesystem source knows
 * the pattern for the same reason.
 *
 * So the boot loader is the second of the two legitimate privileged callers, and
 * the guarantee moves up a layer: what stops the pattern reaching a browser is
 * that no route puts it in a response, which `voice/spoiler-gate.test.ts` and
 * its API-level counterpart assert directly. The grants are what stop a *new*
 * route reaching it by accident.
 */
async function loadFromDb(): Promise<CodingProblem[]> {
  return withPrivileged(async (client) => {
    const { rows } = await client.query<{ slug: string; pattern: string | null; difficulty: string }>(
      `select slug, pattern, difficulty from problem
       where track = 'coding' and retired_at is null
       order by slug`,
    )
    return rows.map((row) => ({
      slug: row.slug,
      // A problem ingested without a pattern is a data defect, not a reason to
      // crash the picker at boot. `'unknown'` is what `http-server.ts` already
      // records when a directory has moved out from under a coach session.
      pattern: row.pattern ?? 'unknown',
      difficulty: DIFFICULTIES.includes(row.difficulty as Difficulty)
        ? (row.difficulty as Difficulty)
        : 'unrated',
    }))
  })
}

let cache: CodingProblem[] | undefined

/**
 * Fill the cache. Called once from `main()` before the server starts listening.
 *
 * Deliberately not lazy. A lazy first-request load would make the first person
 * to open the app pay for it, would have to be made concurrency-safe, and would
 * turn "the database is unreachable" from a startup failure — which a deploy
 * notices — into a single failed request at three in the morning.
 */
export async function loadProblemCache(): Promise<number> {
  cache = await loadFromDb()
  return cache.length
}

/** Test seam: drop the cache so a test can load a different fixture set. */
export function resetProblemCache(): void {
  cache = undefined
}

function loaded(): CodingProblem[] {
  if (cache === undefined) {
    throw new Error('The problem cache has not been loaded — call loadProblemCache() before serving.')
  }
  return cache
}

export const dbProblems: ProblemSource = {
  list(): CodingProblem[] {
    return loaded()
  },
  find(_root: string, slug: string): CodingProblem | null {
    return loaded().find((problem) => problem.slug === slug) ?? null
  },
}
