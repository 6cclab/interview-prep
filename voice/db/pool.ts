import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * The one place that opens a Postgres connection.
 *
 * Only `VOICE_MODE=deployed` ever reaches this module. A local run has no
 * database, and nothing on the local path imports it — which is why the driver
 * is loaded here rather than in `problems.ts`, whose importers include every
 * coding drill in the repo.
 *
 * ---
 *
 * **Roles are chosen per connection, not per deployment.** `app_runtime` and
 * `app_privileged` are NOLOGIN group roles (see `schema.sql`); the deployment's
 * single login user is granted both, and each checkout drops into one of them
 * with `set local role` for the duration of a transaction. That means the
 * default — the role a query runs under if nobody says otherwise — is the
 * restricted one, and reaching the spoilers takes an explicit call to a
 * differently-named function.
 *
 * Everything runs inside a transaction, including single reads. That is not
 * ceremony: `set local` is what makes both the role and the RLS user revert on
 * release, and a pooled connection that leaked either would hand the next
 * request someone else's privileges.
 */

const { Pool } = pg

export type DbClient = pg.PoolClient

let pool: pg.Pool | undefined

/**
 * `DATABASE_URL`, required and never defaulted.
 *
 * A default of `postgres://localhost/postgres` would make a misconfigured
 * deployment connect to whatever happened to be listening and report success.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('VOICE_MODE=deployed needs DATABASE_URL, which is not set.')
  }
  return url
}

export function getPool(): pg.Pool {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 10 })
  return pool
}

/** Point the pool at a specific database. Used by tests and by `pnpm ingest`. */
export function configurePool(connectionString: string, max = 5): void {
  void closePool()
  pool = new Pool({ connectionString, max })
}

export async function closePool(): Promise<void> {
  const open = pool
  pool = undefined
  if (open) await open.end()
}

async function inRole<T>(
  role: 'app_runtime' | 'app_privileged',
  userId: string | null,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${role}`)
    // Parameterised, unlike the role: a user id is data and arrives from a
    // session cookie. `set_config` is the function form of `SET`, and is the
    // only form that takes a bind parameter.
    if (userId !== null) await client.query("select set_config('app.user_id', $1, true)", [userId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * A request-serving transaction, scoped to one person.
 *
 * `userId` sets `app.user_id`, which every RLS policy filters on. Passing
 * `null` is legitimate — a route that reads only problem definitions has no
 * user — and yields a connection that can see zero rows of anybody's work.
 */
export function withRuntime<T>(userId: string | null, fn: (client: DbClient) => Promise<T>): Promise<T> {
  return inRole('app_runtime', userId, fn)
}

/**
 * A transaction that can see spoilers.
 *
 * Two callers, and there should never be a third without a reason written down:
 * the ingester, which writes them, and the boot-time problem loader, which needs
 * `pattern` for hint rung 2 and the coach track. It holds no privilege on any
 * user-owned table, so it cannot be the accidental answer to a permissions
 * error somewhere else.
 */
export function withPrivileged<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  return inRole('app_privileged', null, fn)
}

/**
 * A transaction that may move rows from one person to another, and do nothing
 * else with them.
 *
 * The one legitimate case is an anonymous visitor registering: their work has
 * to follow them onto the real account.
 *
 * It runs **as `from`**, with `app.relink_to` additionally set. Both are needed
 * and neither alone is enough — see the long note in `schema.sql`, which records
 * why, and which of the two obvious designs fail and how.
 *
 * The extra power this grants is therefore exact: it is the anonymous user's own
 * session, plus permission to write one specific other id into `user_id`. A
 * third person's rows are not visible to it and not writable by it, which is the
 * property that matters. It can do nothing to `from`'s rows that `from`'s own
 * session could not already do.
 *
 * One transaction, so a half-carried account is not a state that can exist.
 */
export async function withRelink<T>(
  from: string,
  to: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query('set local role app_runtime')
    await client.query("select set_config('app.user_id', $1, true)", [from])
    await client.query("select set_config('app.relink_to', $1, true)", [to])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

const here = dirname(fileURLToPath(import.meta.url))

/** The schema, as text. Separate from applying it so a test can assert on it. */
export function schemaSql(): string {
  return readFileSync(join(here, 'schema.sql'), 'utf8')
}

/**
 * Apply the schema. Idempotent — every statement in it is `if not exists` or
 * `create or replace`, so this runs on every deploy without a migration ledger.
 *
 * Runs as the connecting user rather than through `withRuntime`/`withPrivileged`:
 * it creates the roles those functions switch into.
 */
export async function applySchema(): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query(schemaSql())
  } finally {
    client.release()
  }
}
