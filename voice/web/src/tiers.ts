/**
 * Difficulty tiers for the coding problem picker.
 *
 * Its own module rather than logic inside `Home.tsx` so it can be tested
 * directly. The lesson this repo keeps re-learning is that a defect in a
 * component's derived state is invisible to a passing suite until someone opens
 * a browser; a pure function is not.
 *
 * The tier comes from `meta.yaml` via `GET /api/problems?track=coding`. It is
 * safe to show — unlike the pattern, which is the answer and never leaves the
 * server (see `voice/problems.ts`).
 */

/**
 * The tiers, easiest first, with what each one means.
 *
 * Ordered rather than alphabetical, and labelled rather than bare, because the
 * whole reason difficulty is on screen is to make opening with a warm-up an
 * obvious move instead of a guess. Twenty-six slugs in alphabetical order offer
 * no way to find the gentle one.
 */
export const TIERS: { key: string; label: string }[] = [
  { key: 'warmup', label: 'Warm-up — no cost trap, correctness only' },
  { key: 'easy', label: 'Easy — one clear insight' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'unrated', label: 'Unrated' },
]

/** Position in `TIERS`; an unknown or absent tier sorts last. */
export function rank(tier: string | undefined): number {
  const at = TIERS.findIndex((entry) => entry.key === tier)
  return at === -1 ? TIERS.length : at
}

/** The slug to open on: the easiest tier, keeping the server's order within it. */
export function easiest(problems: string[], difficulties: Record<string, string>): string {
  let best: string | undefined
  for (const problem of problems) {
    if (best === undefined || rank(difficulties[problem]) < rank(difficulties[best])) best = problem
  }
  return best ?? ''
}

export interface TierGroup {
  label: string
  problems: string[]
}

/**
 * The list split into `<optgroup>`s, or `null` when there is nothing to group by.
 *
 * `null` rather than one catch-all group is deliberate: a single `<optgroup>`
 * wrapping everything is noise that says nothing, and the design track — which
 * has no difficulty field at all — is always in that case.
 *
 * A tier the server sends that `TIERS` does not list still appears, under its own
 * raw name and after the known ones. An unrecognised tier must not be able to
 * make a problem unpickable.
 */
export function groupByTier(problems: string[], difficulties: Record<string, string>): TierGroup[] | null {
  if (!problems.some((problem) => difficulties[problem] !== undefined)) return null

  const known = TIERS.map((tier) => tier.key)
  const unknown = [
    ...new Set(
      problems
        .map((problem) => difficulties[problem])
        .filter((tier): tier is string => tier !== undefined && !known.includes(tier)),
    ),
  ]

  return [...known, ...unknown]
    .map((key) => ({
      label: TIERS.find((tier) => tier.key === key)?.label ?? key,
      problems: problems.filter((problem) => (difficulties[problem] ?? 'unrated') === key),
    }))
    .filter((group) => group.problems.length > 0)
}
