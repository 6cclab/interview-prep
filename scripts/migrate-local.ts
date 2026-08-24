import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyMigration, formatRejects, planMigration, type MigrationPlan } from '../voice/db/migrate-local'
import { applySchema, closePool, databaseUrl } from '../voice/db/pool'

/**
 * `pnpm migrate-local` — move the `local/` record into Postgres, once, by hand.
 *
 *   pnpm migrate-local --user <id> --dry-run    report, write nothing
 *   pnpm migrate-local --user <id>              apply
 *
 * `--user` is required and never guessed. Every row is owned by somebody in the
 * new schema, and picking that somebody automatically — the first row in `user`,
 * say — would silently attach a person's entire interview history to whichever
 * account happened to sort first.
 *
 * The dry run is not optional politeness. This is a one-time import of records
 * that cannot be regenerated, and the only moment anyone can see what would be
 * dropped is before it is dropped.
 */

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function report(plan: MigrationPlan): void {
  console.log(`drills    ${plan.drills.length}`)
  console.log(`attempts  ${plan.attempts.length}`)
  console.log(`pairings  ${plan.pairings.length}`)
  console.log(`stories   ${plan.stories.length}`)
  for (const story of plan.stories) console.log(`            ${story.competency}`)
  console.log(`rejected  ${plan.rejected.length}`)
  // Verbatim, and every one of them. A count of rejects is a number nobody can
  // check; the line itself is the only thing that lets someone say "that one
  // matters, fix the parser" or "that one is the header, fine".
  for (const { source, line, reason } of plan.rejected) {
    console.log(`            ${source}: ${reason}`)
    console.log(`              ${line}`)
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const userId = flag('user')
  if (!userId) {
    console.error(
      'pnpm migrate-local --user <id> [--dry-run]\n\n' +
        'The user id owns every migrated row. Find it in the `user` table, or sign in\n' +
        'on the deployed instance and read it from `/api/auth/get-session`.',
    )
    process.exit(1)
  }
  const url = databaseUrl()
  console.log(`${dryRun ? 'Dry run against' : 'Migrating into'} ${url.replace(/:[^:@/]*@/, ':***@')}`)
  console.log(`Owner: ${userId}\n`)

  try {
    await applySchema()
    const root = process.cwd()
    const plan = planMigration(root)
    report(plan)

    if (plan.rejected.length > 0) {
      const path = join(root, 'local/migration-rejects.md')
      writeFileSync(path, formatRejects(plan.rejected))
      console.log(`\nRejects written to ${path} — read them before applying.`)
    }

    if (dryRun) {
      console.log('\nDry run — nothing was written.')
      return
    }

    const counts = await applyMigration(userId, plan)
    console.log('\nApplied.')
    console.log(`  ${counts.drills} drills, ${counts.attempts} attempts, ${counts.pairings} pairings, ${counts.stories} stories`)
    if (counts.orphanedDrills > 0) {
      console.log(`  ${counts.orphanedDrills} drill(s) kept with no problem — the slug no longer resolves.`)
    }
    if (counts.skippedAttempts > 0) {
      console.log(`  ${counts.skippedAttempts} attempt(s) skipped — the slug no longer resolves, and an`)
      console.log('    attempt with nothing saying what it answered is unreadable.')
    }
  } finally {
    await closePool()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
