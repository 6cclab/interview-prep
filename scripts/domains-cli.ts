import { readFileSync } from 'node:fs'
import {
  companyDomains,
  companyPath,
  domainCounts,
  listExercises,
  matchDomains,
  type Exercise,
  type Match,
} from './domains'

/**
 * `pnpm domains` — which exercises fit a domain, or a company.
 *
 *   pnpm domains                     every domain, with counts
 *   pnpm domains payments offline-sync   exercises touching either
 *   pnpm domains --for toast         exercises fitting a company's domains
 *
 * The `--for` form reads the company's own research in `local/`, which is
 * gitignored — see the comment at the top of `domains.ts` for why the join runs
 * this way round rather than tagging exercises with company names.
 */

const root = process.cwd()

function label(exercise: Exercise): string {
  return `${exercise.track}/${exercise.slug}`
}

function printMatches(matches: Match[], wanted: string[]): void {
  if (matches.length === 0) {
    // Not an error. The authored set is what it is, and "nothing here fits" is
    // the honest answer — the alternative is inventing an exercise to fill the
    // gap, which is the one thing this must never do.
    console.log(`No exercises match ${wanted.join(', ')}.`)
    console.log('Run `pnpm domains` to see the domains that do exist.')
    return
  }
  const width = Math.max(...matches.map((match) => label(match.exercise).length))
  for (const match of matches) {
    console.log(`${label(match.exercise).padEnd(width)}  ${match.exercise.title}`)
    console.log(`${' '.repeat(width)}  → ${match.matched.join(', ')}`)
  }
}

const args = process.argv.slice(2)
const exercises = listExercises(root)

if (args[0] === '--for') {
  const company = args[1]
  if (!company) {
    console.error('Usage: pnpm domains --for <company>')
    process.exit(1)
  }
  const path = companyPath(root, company)
  if (!path) {
    console.error(`No research for ${company} — expected local/companies/${company}.md.`)
    console.error('Run `/prep <company>` first.')
    process.exit(1)
  }
  const wanted = companyDomains(readFileSync(path, 'utf8'))
  if (wanted === null) {
    // Deliberately does not guess. The doc is his research, the domains are a
    // judgement about it, and inferring them from prose is exactly the kind of
    // plausible-sounding fabrication `/prep` exists to catch.
    console.error(`local/companies/${company}.md declares no domains.`)
    console.error('Add one line anywhere in it, listing the domains from `pnpm domains`:')
    console.error('')
    console.error('  <!-- drill-domains: payments, idempotency, offline-sync -->')
    process.exit(1)
  }
  if (wanted.length === 0) {
    console.log(`local/companies/${company}.md declares no domains apply.`)
    process.exit(0)
  }
  console.log(`${company} — ${wanted.join(', ')}\n`)
  printMatches(matchDomains(exercises, wanted), wanted)
} else if (args.length > 0) {
  printMatches(matchDomains(exercises, args), args)
} else {
  const counts = domainCounts(exercises)
  if (counts.length === 0) {
    console.log('No exercise declares a domain yet.')
  } else {
    const width = Math.max(...counts.map((entry) => entry.domain.length))
    for (const { domain, count } of counts) {
      console.log(`${domain.padEnd(width)}  ${count}`)
    }
    console.log(`\n${exercises.length} exercises tagged. Filter: pnpm domains <domain>...`)
  }
}
