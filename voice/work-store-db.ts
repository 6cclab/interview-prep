import { withRuntime, type DbClient } from './db/pool'
import type { CoachedRow } from './coached'
import type { HistoryRow } from './drill-log'
import { summarise } from './drill-log'
import type { DrillLogRow, StoryLog } from './transcript'
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
            // Server-side vitest, until the browser runner reports its own
            // verdicts. Recorded rather than assumed, because a browser verdict
            // is forgeable and the point is that it is distinguishable.
            'server',
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
