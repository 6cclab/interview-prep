import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which exercises are worth drilling for a given company.
 *
 * The join is deliberately indirect, and the indirection is the point:
 *
 *   committed:  exercise -> domains        (a `meta.yaml` per exercise)
 *   private:    company  -> domains        (one line in `local/companies/<x>.md`)
 *   at runtime: company  -> exercises      (the intersection, computed here)
 *
 * A direct `companies:` tag on each exercise would be simpler and wrong. It
 * would commit a claim about a specific employer's interview loop to a repo the
 * spec says must be publishable un-redacted, and `local/` exists precisely so
 * that company research is not published. So nothing committed names a company;
 * the naming happens in the gitignored research doc, which is also the only
 * place where the evidence and the confidence level for the claim live.
 *
 * The stronger reason is honesty about what the research supports. `/prep`
 * already caught and excluded two fabrications while researching one company,
 * and the reports it *did* trust name exactly one coding question. There is no
 * evidence base for "company X asks this problem", so this deliberately cannot
 * express that. What the research does support is a company's *domain* —
 * payments, offline sync, menu modelling — and matching authored exercises to a
 * domain is a claim about the exercise, which is checkable by reading it.
 *
 * So this selects from the authored set and never generates. An empty result is
 * a real answer: nothing here fits, and inventing something to fill the gap is
 * the failure mode the whole arrangement exists to prevent.
 */

/** The tracks whose exercises carry domains. Order is the display order. */
export const DOMAIN_TRACKS = ['debugging', 'feature', 'system-design'] as const

export type DomainTrack = (typeof DOMAIN_TRACKS)[number]

export interface Exercise {
  /** Derived from the directory, never read from the file — see `readMeta`. */
  track: DomainTrack
  slug: string
  /** The `title:` from `meta.yaml`, or the slug if it has none. */
  title: string
  domains: string[]
}

/**
 * The fields of `meta.yaml` this needs, and nothing else.
 *
 * A hand-rolled reader rather than a YAML dependency: the repo has no YAML
 * parser and these files are two scalars and a list. It handles exactly the
 * shape the exercise metas are written in — `key: value` and a `-` list under a
 * key — and ignores everything else rather than guessing. If a meta ever needs
 * nested structure, that is the point to take the dependency, not before.
 */
function readMeta(file: string): { title?: string; domains: string[] } {
  const meta: { title?: string; domains: string[] } = { domains: [] }
  let inDomains = false
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line === '' || line.trimStart().startsWith('#')) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item) {
      if (inDomains) meta.domains.push(unquote(item[1]!))
      continue
    }
    // Any unindented key ends the list it was collecting.
    inDomains = false
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    const [, key, value] = pair as unknown as [string, string, string]
    if (key === 'domains' && value === '') inDomains = true
    else if (key === 'title') meta.title = unquote(value)
  }
  return meta
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value.trim())
  return quoted ? quoted[2]! : value.trim()
}

/**
 * Every exercise that declares domains, across the applied tracks.
 *
 * `track` and `slug` come from the path rather than from the file. A `track:`
 * field would be a second source of truth for something the directory already
 * states, and the failure mode is silent: a copy-pasted meta would file an
 * exercise under a track it is not in, and nothing would ever contradict it.
 *
 * An exercise with no `meta.yaml`, or one with no domains, is skipped rather
 * than reported as untagged — a missing tag is a to-do, not an error, and this
 * is read during a drill.
 */
export function listExercises(root: string): Exercise[] {
  const found: Exercise[] = []
  for (const track of DOMAIN_TRACKS) {
    const base = join(root, track)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(base, entry.name, 'meta.yaml')
      if (!existsSync(file)) continue
      const meta = readMeta(file)
      if (meta.domains.length === 0) continue
      found.push({
        track,
        slug: entry.name,
        title: meta.title ?? entry.name,
        domains: meta.domains,
      })
    }
  }
  return found
}

/** Every declared domain with how many exercises carry it, commonest first. */
export function domainCounts(exercises: Exercise[]): { domain: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const exercise of exercises) {
    for (const domain of exercise.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  return [...counts]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

export interface Match {
  exercise: Exercise
  /** The wanted domains this exercise carries — the reason it was selected. */
  matched: string[]
}

/**
 * The exercises touching any of `wanted`, best-matching first.
 *
 * Ranked by how many of the wanted domains an exercise covers, so an exercise
 * sitting at the intersection of two of a company's domains outranks one that
 * clips a single domain. `matched` is returned rather than just the exercise
 * because the reason for a selection is the useful part: it says which of the
 * company's domains a drill is actually practising.
 *
 * Matching is case-insensitive on the domain slug and nothing more. No fuzzy
 * matching, no synonyms — a near-miss that silently matches would put an
 * exercise in front of him with a fabricated reason, and a domain typo is
 * better surfaced as a domain that matches nothing.
 */
export function matchDomains(exercises: Exercise[], wanted: string[]): Match[] {
  const want = new Set(wanted.map((domain) => domain.trim().toLowerCase()).filter(Boolean))
  const matches: Match[] = []
  for (const exercise of exercises) {
    const matched = exercise.domains.filter((domain) => want.has(domain.toLowerCase()))
    if (matched.length > 0) matches.push({ exercise, matched })
  }
  return matches.sort(
    (a, b) =>
      b.matched.length - a.matched.length ||
      a.exercise.track.localeCompare(b.exercise.track) ||
      a.exercise.slug.localeCompare(b.exercise.slug),
  )
}

/** The marker a company's research doc uses to declare its domains. */
const COMPANY_DOMAINS = /^\s*<!--\s*drill-domains:\s*([^>]*?)\s*-->\s*$/im

/**
 * The domains declared in a company's research doc, or `null` if it declares none.
 *
 * An HTML comment on one line, because the doc is prose written for a human to
 * read and this must not disturb it: the marker renders as nothing, sorts
 * anywhere in the file, and is editable without a schema. `null` and `[]` are
 * different answers — no marker means the doc has not been tagged yet, which
 * the CLI can explain, while a marker listing nothing is a deliberate "no
 * domains apply".
 */
export function companyDomains(markdown: string): string[] | null {
  const found = COMPANY_DOMAINS.exec(markdown)
  if (!found) return null
  return found[1]!
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean)
}

/** `local/companies/<slug>.md`, or `null` when there is no research for it. */
export function companyPath(root: string, slug: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null
  const path = join(root, 'local', 'companies', `${slug}.md`)
  return existsSync(path) ? path : null
}
