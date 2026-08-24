import type { IncomingMessage } from 'node:http'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { anonymous } from 'better-auth/plugins/anonymous'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { getPool, withRelink, type DbClient } from './pool'

/**
 * Who a request is, on a deployed instance.
 *
 * **Anonymous by default, and no fingerprint.** Better Auth's anonymous plugin
 * mints a real `user` row flagged `isAnonymous` with an ordinary session cookie,
 * and fires `onLinkAccount` when that person later registers. A fingerprint was
 * rejected for this: it is unstable across browser updates, blockable, makes an
 * unregistered visitor durably trackable, and on a shared machine can attach two
 * people to one row. The honest boundary — *a cookie holds your work on this
 * browser; registering makes it follow you* — is a sentence that can be put on
 * screen. A fingerprint's boundary cannot.
 *
 * Local mode never loads this module. There is no auth, no cookie and no
 * database in a local run, and `resolveUserId` is `null` for every request.
 */

/** Better Auth owns four tables and generates their DDL itself. */
export const VENDOR_TABLES = ['user', 'session', 'account', 'verification'] as const

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value === '') {
    throw new Error(`VOICE_MODE=deployed needs ${name}, which is not set.`)
  }
  return value
}

/**
 * The secret that signs session cookies, and the origin they are scoped to.
 *
 * Both required, neither defaulted. A generated-at-boot secret would invalidate
 * every live session on every restart and would differ between replicas; a
 * defaulted one would be the same on every deployment of this code, which is
 * the same as having none.
 */
export function authConfig(env: NodeJS.ProcessEnv = process.env): { secret: string; baseURL: string } {
  return { secret: required('AUTH_SECRET', env), baseURL: required('AUTH_BASE_URL', env) }
}

/**
 * Carry an anonymous visitor's work onto the account they just registered.
 *
 * One transaction, and written so that running it twice is harmless: the second
 * run's `where user_id = $old` matches nothing, because the first run already
 * moved those rows. Better Auth may retry the hook, and a half-migrated account
 * — some drills carried across, some stranded on a row nobody can log into
 * again — is not a state worth being able to reach.
 *
 * Exported so it can be tested without standing up an auth server, which is the
 * only way to test the thing that actually matters here.
 */
export async function linkAnonymousWork(from: string, to: string): Promise<number> {
  if (from === to) return 0
  return withRelink(from, to, async (client: DbClient) => {
    let moved = 0
    for (const table of [
      'solution_buffer',
      'drill_log',
      'transcript',
      'attempt_archive',
      'pairing_log',
      'story',
    ]) {
      const result = await client.query(`update ${table} set user_id = $1 where user_id = $2`, [to, from])
      moved += result.rowCount ?? 0
    }
    return moved
  })
}

let cached: ReturnType<typeof build> | undefined

function build(env: NodeJS.ProcessEnv) {
  const { secret, baseURL } = authConfig(env)
  return betterAuth({
    database: getPool(),
    secret,
    baseURL,
    // Registering with a password is the only way an anonymous visitor becomes
    // durable. Social providers are not configured, deliberately: each one is a
    // third party learning that this person practises interviews, in exchange
    // for saving them a password field.
    emailAndPassword: { enabled: true },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await linkAnonymousWork(anonymousUser.user.id, newUser.user.id)
        },
      }),
    ],
  })
}

export function getAuth(env: NodeJS.ProcessEnv = process.env): ReturnType<typeof build> {
  cached ??= build(env)
  return cached
}

/** Test seam: forget the built instance so a test can point at another database. */
export function resetAuth(): void {
  cached = undefined
}

/**
 * Create the four vendor tables, and nothing else.
 *
 * Programmatic rather than shelling out to `@better-auth/cli`, so a deploy runs
 * one command and so the migration cannot drift from the plugin list this file
 * actually configures — the CLI reads a config file, and a second source of
 * truth for which plugins are enabled is a second thing to forget to update.
 *
 * No hand-written DDL and no hand-added columns on these tables. Every app
 * table references `user.id` by its generated type rather than an assumed one.
 */
export async function applyAuthSchema(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { runMigrations } = await getMigrations(getAuth(env).options)
  await runMigrations()
}

/** The `/api/auth/*` handler, mounted first in the chain. See `http-server.ts`. */
export function authHandler(env: NodeJS.ProcessEnv = process.env) {
  return toNodeHandler(getAuth(env))
}

/**
 * The signed-in user's id, or `null`.
 *
 * Resolved from the cookie by Better Auth, which verifies the signature — not
 * from a header. The identity layer this replaces trusted a proxy-set
 * `X-authentik-uid`, which required four separate mechanisms to be
 * simultaneously true, one of which turned out to enforce nothing. A cookie
 * Better Auth has verified needs none of them.
 */
export async function resolveUserId(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const session = await getAuth(env).api.getSession({ headers: fromNodeHeaders(req.headers) })
    return session?.user.id ?? null
  } catch {
    // An unreadable or expired cookie is an anonymous request, not a 500. The
    // client's answer to being unauthenticated is to sign in anonymously, which
    // is a path that works; a 500 is a path that does not.
    return null
  }
}
