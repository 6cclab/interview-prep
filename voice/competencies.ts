import { competencyCoverage } from './context'

/**
 * The behavioural competencies, as things a client can ask for.
 *
 * The landing page offered exactly one behavioural entry — "Behavioral drill" —
 * while the design and coding cards offered pickers, so twelve competencies and
 * seventy-two authored questions were unreachable from the browser. This turns
 * the headings in `behavioral/competencies.md` into a selectable list.
 *
 * **Slugs, not titles, cross the wire.** A competency title is prose with
 * slashes and spaces ("Conflict / disagreement with a peer"), and every guard in
 * this codebase validates client input against `PROBLEM_SLUG` — one rule,
 * duplicated nowhere. Resolving a slug to a title server-side is the same
 * arrangement `voice/problems.ts` uses for problems, and for the same reason:
 * the client sends an opaque token and the server owns the mapping.
 *
 * **Choosing a competency is a deliberate trade, and the default is not to.**
 * `questions.md` opens with a section on spotting the competency behind
 * unfamiliar phrasing, which is a skill an interview tests — so being told it up
 * front removes something real. Picking one is worth it for deliberate practice
 * on a known gap; the interviewer's-choice entry stays the default, the same
 * shape as the history screen's pattern reveal.
 */

export interface Competency {
  /** URL- and wire-safe. Matches `PROBLEM_SLUG`. */
  slug: string
  /** The heading as authored, which is what reaches the prompt. */
  title: string
  /** Whether `local/stories.md` has a heading for it. A competency with no story is the gap worth drilling. */
  hasStory: boolean
}

/**
 * A heading to a slug.
 *
 * Lossy on purpose — "Conflict / disagreement with a peer" and
 * "Conflict — disagreement with a peer" would collide. That is acceptable
 * because `findCompetency` resolves against the real headings rather than
 * trusting the slug to round-trip, and a collision would show up immediately as
 * two identical entries in the picker rather than as a wrong drill.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function listCompetencies(root: string): Competency[] {
  const { all, covered } = competencyCoverage(root)
  return all.map((title) => ({
    slug: slugify(title),
    title,
    hasStory: covered.includes(title),
  }))
}

/** The competency a slug names, or null. Resolved against the file, never reconstructed from the slug. */
export function findCompetency(root: string, slug: string): Competency | null {
  return listCompetencies(root).find((c) => c.slug === slug) ?? null
}
