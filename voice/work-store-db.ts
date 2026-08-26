import { withRuntime, type DbClient } from './db/pool'
import type { CoachedRow } from './coached'
import type { HistoryRow } from './drill-log'
import { summarise } from './drill-log'
import type { DrillLogRow, StoryLog } from './transcript'
import { versionOf, type SolutionFile, type WriteOutcome } from './solution-file'
import type { HistoryPayload, SavedTranscript, WorkStore } from './work-store'

/**
 * One person's record, in Postgres.
 *
 * Every query runs through `withRuntime(userId, ...)`, which sets `app.user_id`
 * for the transaction. That is not belt-and-braces around the `where user_id`
 * clauses below — it is the actual guarantee. Row-level security means a query
 * here that forgot its clause returns nothing rather than somebody else's
 * drills, and `voice/db/postgres.test.ts` proves that by running one without.
 *
 * `problem_id` is resolved by slug through the public view. A slug that no
 * longer resolves — a problem retired since the drill was taken — still gets a
 * row, with a null `problem_id`: the solved/hints/elapsed numbers are real
 * history and worth keeping, and `on delete set null` on that column exists for
 * the same reason.
 */

async function problemIdFor(client: DbClient, slug: string | undefined): Promise<string | null> {
  if (slug === undefined) return null
  const { rows } = await client.query<{ id: string }>(
    "select id from problem_public where track = 'coding' and slug = $1",
    [slug],
  )
  return rows[0]?.id ?? null
}

/**
 * The insert, and what a zero rowcount means.
 *
 * Exported and taking a client so a test can drive two of these through
 * interleaved transactions — which is the only way to reach the branch below.
 * Inlined in `writeSolution` it was unreachable from any test: two calls through
 * the store serialise, and the loser is caught by the version check one step
 * earlier. Removing this branch left the whole suite green, which is how that
 * was found.
 *
 * The conflict path fires only when a row appeared between the caller's `select
 * ... for update` and this insert — two first writes for the same buffer, which
 * `for update` cannot serialise because there was no row to lock. The re-check
 * in the `where` clause is what decides that race; a zero rowcount is how it
 * reports having lost. `stale` rather than a write that silently vanishes.
 *
 * `based_on_content_hash` is not written: it exists for the "the stub or the
 * tests changed under you" banner, which compares against the problem's own
 * hash and is not built yet. A value nothing reads is a field that looks
 * maintained and is not.
 */
export async function upsertBuffer(
  client: DbClient,
  userId: string,
  problemId: string,
  text: string,
  expected: string,
): Promise<'ok' | 'stale'> {
  const written = await client.query(
    `insert into solution_buffer (user_id, problem_id, content, updated_at)
     values ($1, $2, $3, now())
     on conflict (user_id, problem_id) do update
       set content = excluded.content, updated_at = now()
       where solution_buffer.content = $4`,
    [userId, problemId, text, expected],
  )
  return written.rowCount === 0 ? 'stale' : 'ok'
}

/** The `stub` document's text, or null when the problem carries no code. */
async function stubFor(client: DbClient, problemId: string): Promise<string | null> {
  const { rows } = await client.query<{ content: string }>(
    "select content from problem_document_public where problem_id = $1 and kind = 'stub'",
    [problemId],
  )
  return rows[0]?.content ?? null
}

/** This person's buffer if they have one, otherwise the stub they would start from. */
async function bufferOrStub(
  client: DbClient,
  userId: string,
  problemId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ content: string }>(
    'select content from solution_buffer where user_id = $1 and problem_id = $2',
    [userId, problemId],
  )
  return rows[0]?.content ?? (await stubFor(client, problemId))
}

export function dbWorkStore(userId: string | null): WorkStore {
  // A null user cannot own anything, and every RLS policy would reject the
  // write anyway. Failing here rather than there turns a `row-level security`
  // error deep in a driver into a sentence naming the actual problem.
  function owner(): string {
    if (userId === null) {
      throw new Error('Deployed mode cannot save work for an unauthenticated request.')
    }
    return userId
  }

  return {
    /**
     * The buffer, as a row rather than a file.
     *
     * A deployed instance has one checkout and several people, so `solution.ts`
     * on disk is not "the candidate's working file", it is a file everyone
     * shares — two people drilling the same problem would overwrite each other,
     * and the loser would watch their own editor change under them.
     *
     * **A first read returns the stub, and does not write a row.** The buffer
     * comes into existence when something is typed. Seeding on read would put a
     * row in the table for every problem anyone merely opened, and would make
     * "has this person started this problem" — a question `/status` asks in
     * spirit — answer yes for a glance.
     *
     * The stub, never `solution` — that document is a spoiler, `is_spoiler` is
     * true on it at ingest, and `app_runtime` cannot read it through
     * `problem_document_public` at all. The grant is what enforces that; this
     * comment only records that it is deliberate.
     */
    async readSolution(slug: string): Promise<SolutionFile | null> {
      return withRuntime(owner(), async (client) => {
        const problemId = await problemIdFor(client, slug)
        if (problemId === null) return null
        const text = await bufferOrStub(client, owner(), problemId)
        return text === null ? null : { text, version: versionOf(text) }
      })
    },

    /**
     * Compare-and-set, inside one transaction.
     *
     * The read and the write have to be atomic or the guard is decorative: two
     * tabs both read version A, both find it current, and both write — the
     * second silently destroying the first's work, which is the entire failure
     * the version is here to prevent. `withRuntime` opens a transaction and
     * `for update` locks the row for its duration, so the second caller waits
     * and then correctly sees a version that is no longer what it expected.
     *
     * `for update` on a row that does not exist locks nothing, so two first
     * writes can race. `on conflict` resolves that at the unique index rather
     * than in application code — but resolving it means one of them wins, so the
     * conflict path re-checks the version it is overwriting rather than assuming
     * its own read is still true.
     */
    async writeSolution(slug: string, text: string, expected: string): Promise<WriteOutcome> {
      return withRuntime(owner(), async (client) => {
        const problemId = await problemIdFor(client, slug)
        if (problemId === null) return 'missing'

        const { rows } = await client.query<{ content: string }>(
          'select content from solution_buffer where user_id = $1 and problem_id = $2 for update',
          [owner(), problemId],
        )
        const current = rows[0]?.content ?? (await stubFor(client, problemId))
        // No row and no stub means the problem exists but carries no code —
        // system design, for one. There is nothing to edit and nothing to
        // compare against.
        if (current === null) return 'missing'
        if (versionOf(current) !== expected) return 'stale'

        return upsertBuffer(client, owner(), problemId, text, current)
      })
    },

    async saveTranscript({ body, track }): Promise<SavedTranscript> {
      // The preferred path is ignored, deliberately: it encodes a directory
      // layout — `local/designs/<problem>-live-...` — that means nothing here.
      // What comes back is a row reference, because that is honestly where the
      // transcript now is.
      const id = await withRuntime(owner(), async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into transcript (user_id, track, problem_id, started_at, body, transport)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [owner(), track, null, new Date(), body, null],
        )
        return rows[0]!.id
      })
      return { location: `transcript #${id}` }
    },

    async appendDrillLog(row: DrillLogRow): Promise<void> {
      await withRuntime(owner(), async (client) => {
        await client.query(
          `insert into drill_log
             (user_id, problem_id, started_at, track, solved, hints, elapsed_ms, verified_by, note)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            owner(),
            await problemIdFor(client, row.problem),
            row.startedAt,
            // `pattern` is the only thing distinguishing the two tracks in the
            // Markdown log, where `debugging` is written into the pattern
            // column. Here the track has a column of its own, so it says so.
            row.pattern === 'debugging' ? 'debug' : 'coding',
            row.solved ? 'solved' : 'unsolved',
            row.hints,
            row.elapsedMs,
            // Recorded rather than assumed, because a browser verdict is
            // forgeable and the point is that it is distinguishable, not that
            // it is prevented. Absent means server-side vitest — every caller
            // that does not set it is a local run, where it is the truth.
            row.verifiedBy ?? 'server',
            row.note,
          ],
        )
      })
    },

    async appendStoryLog(log: StoryLog): Promise<void> {
      await withRuntime(owner(), async (client) => {
        await client.query(
          'insert into story (user_id, competency, story, worked, fix) values ($1, $2, $3, $4, $5)',
          [owner(), log.competency, log.story, log.worked, log.fix],
        )
      })
    },

    async appendCoached(row: CoachedRow): Promise<void> {
      await withRuntime(owner(), async (client) => {
        await client.query(
          'insert into pairing_log (user_id, problem_id, occurred_on, minutes) values ($1, $2, $3, $4)',
          [owner(), await problemIdFor(client, row.problem), row.date, row.minutes],
        )
      })
    },

    async readHistory(): Promise<HistoryPayload> {
      return withRuntime(owner(), async (client) => {
        // The join reaches `problem.pattern`, which `app_runtime` cannot read —
        // and that is correct rather than an obstacle. `?patterns=1` is the one
        // caller that wants it, and it is a deliberate reveal that belongs
        // behind the privileged door rather than in the default history read.
        const { rows } = await client.query<{
          slug: string | null
          started_at: Date
          solved: string
          hints: number
          elapsed_ms: string | null
          note: string
        }>(
          `select p.slug, d.started_at, d.solved, d.hints, d.elapsed_ms, d.note
           from drill_log d
           left join problem_public p on p.id = d.problem_id
           order by d.started_at desc`,
        )
        const history: HistoryRow[] = rows.map((row) => ({
          date: row.started_at.toISOString().slice(0, 10),
          // A drill whose problem has since been retired keeps its numbers and
          // loses its name. `'unknown'` rather than dropping the row: the
          // solved/hints/elapsed figures are real history, and `/status` reads
          // them.
          problem: row.slug ?? 'unknown',
          // Never populated here. The pattern lives behind the privileged door,
          // and `?patterns=1` is the one caller entitled to ask for it — see the
          // note above the query.
          pattern: '',
          // `solved` stays strict and `result` carries the three-valued reading,
          // exactly as the Markdown reader does. Every count on the screen is
          // derived from the boolean, so widening it would inflate the
          // cold-solve figure the whole record is built around.
          solved: row.solved === 'solved',
          result: row.solved === 'solved' ? 'solved' : row.solved === 'partial' ? 'partial' : 'unsolved',
          hints: row.hints,
          // `bigint` arrives as a string from the driver, because it does not
          // fit a JS number in general. It does here, and `Number` is safe for
          // any elapsed time a human sits through.
          elapsedMs: row.elapsed_ms === null ? 0 : Number(row.elapsed_ms),
          note: row.note,
        }))
        const paired = await client.query<{ slug: string }>(
          `select distinct p.slug from pairing_log l
           join problem_public p on p.id = l.problem_id`,
        )
        return {
          rows: history,
          summary: summarise(history),
          coached: paired.rows.map((r) => r.slug),
        }
      })
    },
  }
}
