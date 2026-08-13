import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from '../voice/user-root'

const LOCAL_DIR = 'local'

// mkcert TLS material for local HTTPS. A deployed instance terminates TLS at
// Traefik, so this belongs to the machine the drill server runs on, not to
// any one person's practice history — moving it under a user id would strand
// it somewhere nothing looks for certs.
const EXCLUDED = new Set(['certs', 'users'])

export interface MigrationSummary {
  moved: string[]
  skipped: string[]
}

/**
 * Move an existing single-user `local/` into `local/users/<uid>/` so a
 * pre-existing drill log, story bank and archived attempts survive the
 * switch to per-user directories.
 *
 * Pure and root-scoped — see `scripts/reset.ts`'s `resolveProblemDir` for why
 * a function tests can reach must take `root` as an argument rather than
 * assuming the real repo: `local/` here is the owner's only copy of his
 * history, and a bug that let a test write into it would be unrecoverable.
 *
 * `certs/` is named in `EXCLUDED` rather than moved: see the comment there.
 * `users/` is excluded for the same guard reason `resolveProblemDir` refuses
 * an ambiguous match — without it, a re-run would nest `local/users/` inside
 * its own destination the moment `<uid>` differed from what was already there.
 *
 * Idempotent: an entry already present at the destination is left alone and
 * reported as skipped, never merged or overwritten — a second run (or a run
 * against a `local/` that has since been repopulated) must not let a stale
 * source file clobber history that already made it across.
 */
export function migrateLocalToUser(root: string, userId: string): MigrationSummary {
  const summary: MigrationSummary = { moved: [], skipped: [] }

  const source = join(root, LOCAL_DIR)
  if (!existsSync(source)) return summary

  // Computed before touching anything: an invalid id must throw here, from
  // `userDataDir` itself, before any file is moved — not reimplemented, and
  // not discovered halfway through a partial migration.
  const dest = userDataDir(root, userId)
  mkdirSync(dest, { recursive: true })

  for (const entry of readdirSync(source)) {
    if (EXCLUDED.has(entry)) continue

    const from = join(source, entry)
    const to = join(dest, entry)

    if (existsSync(to)) {
      summary.skipped.push(entry)
      continue
    }

    renameSync(from, to)
    summary.moved.push(entry)
  }

  return summary
}

const isCli = process.argv[1]?.endsWith('migrate-local-to-user.ts')
if (isCli) {
  const userId = process.argv[2]
  if (!userId) {
    console.error('Usage: pnpm migrate-local-to-user <user-id>')
    process.exit(1)
  }
  try {
    const summary = migrateLocalToUser(process.cwd(), userId)
    if (summary.moved.length === 0 && summary.skipped.length === 0) {
      console.log('Nothing to migrate — no local/ directory found.')
    } else {
      for (const entry of summary.moved) console.log(`Moved local/${entry} -> local/users/${userId}/${entry}`)
      for (const entry of summary.skipped) console.log(`Skipped local/${entry} — already exists at the destination`)
    }
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
