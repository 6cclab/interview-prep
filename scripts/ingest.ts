import { ingest, type IngestSummary } from '../voice/db/ingest'
import { applySchema, closePool, databaseUrl } from '../voice/db/pool'

/**
 * `pnpm ingest` — copy the repo's problem definitions into the deployed store.
 *
 * Two passes, and they are never combined:
 *
 *   pnpm ingest --dry-run    scan, compare, report, roll back
 *   pnpm ingest              apply
 *
 * The dry run exists because the report is only worth reading if it is the
 * report of the *real* run. It takes the same code path and the same
 * transaction, and throws at the end so `withPrivileged` rolls it back.
 *
 * This is a deploy step, not a build step and not something the server does on
 * boot. It writes the server's Postgres, and `voice/web` deliberately has no
 * build-time dependency on server code.
 */

function report(summary: IngestSummary, dryRun: boolean): void {
  const verb = dryRun ? 'would be' : 'were'
  const lines: [string, string[]][] = [
    [`inserted`, summary.inserted],
    [`updated`, summary.updated],
    [`retired`, summary.retired],
  ]
  console.log(dryRun ? 'Dry run — nothing was written.\n' : 'Applied.\n')
  for (const [label, slugs] of lines) {
    console.log(`${label.padEnd(9)} ${slugs.length}`)
    // Named, not counted. The whole point of a dry run over a serving copy is
    // seeing *which* problems move before they move — a count of 3 retirements
    // is not something anyone can check.
    for (const slug of slugs) console.log(`          ${slug}`)
  }
  console.log(`unchanged ${summary.unchanged.length}`)

  if (summary.skipped.length > 0) {
    console.log(`\n${summary.skipped.length} directories ${verb} skipped:`)
    for (const { slug, reason } of summary.skipped) console.log(`  ${slug}: ${reason}`)
    // Loud, and on stderr, because a skipped problem is one that silently
    // stops being offered on the deployed instance.
    console.error(`\nWarning: ${summary.skipped.length} problem(s) could not be read — see above.`)
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  // Read first, so a missing DATABASE_URL is a sentence rather than a driver
  // stack trace from somewhere inside the pool.
  const url = databaseUrl()
  console.log(`${dryRun ? 'Dry run against' : 'Ingesting into'} ${url.replace(/:[^:@/]*@/, ':***@')}\n`)

  try {
    // The schema is applied even on a dry run: it is idempotent, and a dry run
    // against a database that has never been set up would otherwise fail on a
    // missing table and report nothing useful about the tree.
    await applySchema()
    report(await ingest(process.cwd(), { dryRun }), dryRun)
  } finally {
    await closePool()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
