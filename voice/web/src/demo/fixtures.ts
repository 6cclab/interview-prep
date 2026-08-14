/**
 * The demo instance's data.
 *
 * Invented here, in full. Nothing in this file is read from `local/` at build
 * time or any other time — that directory holds one person's drill log, story
 * bank and company research, and the reason it is gitignored is the reason it
 * must not reach a page anyone can open.
 *
 * This is why the demo is a separate build rather than a `readonly=1` flag on
 * the real instance. A flag that only the client honours is not a gate — it is
 * the same mistake `/api/history`'s wire-level `?patterns=1` was designed to
 * avoid, made at much higher stakes, against real private data, in public.
 *
 * The problem *metadata* is real and safe: slugs, titles and difficulties are
 * already served to any client by `/api/problems`. What is invented is the
 * history — who solved what, when, and with how much help.
 */

export interface DemoProblem {
  slug: string
  title: string
  difficulty: 'warmup' | 'easy' | 'medium' | 'hard'
  companies: { name: string; confidence: 'low' | 'medium' }[]
}

/** A small, believable slice. Not the whole set — a demo is a sample, not a mirror. */
export const DEMO_PROBLEMS: DemoProblem[] = [
  { slug: 'contains-duplicate', title: 'Contains Duplicate', difficulty: 'warmup', companies: [] },
  { slug: 'reverse-string', title: 'Reverse String', difficulty: 'warmup', companies: [] },
  { slug: 'valid-anagram', title: 'Valid Anagram', difficulty: 'easy', companies: [{ name: 'Toast', confidence: 'low' }] },
  { slug: 'two-sum-sorted', title: 'Two Sum, Sorted', difficulty: 'easy', companies: [{ name: 'Affirm', confidence: 'medium' }] },
  { slug: 'valid-palindrome', title: 'Valid Palindrome', difficulty: 'easy', companies: [] },
  { slug: 'container-with-most-water', title: 'Container With Most Water', difficulty: 'medium', companies: [{ name: 'CrowdStrike', confidence: 'low' }] },
  { slug: 'longest-substring-no-repeat', title: 'Longest Substring Without Repeating Characters', difficulty: 'medium', companies: [{ name: 'Toast', confidence: 'medium' }] },
  { slug: 'count-islands', title: 'Number of Islands', difficulty: 'medium', companies: [{ name: 'Affirm', confidence: 'low' }] },
  { slug: 'lru-cache', title: 'LRU Cache', difficulty: 'medium', companies: [{ name: 'CrowdStrike', confidence: 'medium' }] },
  { slug: 'n-queens-count', title: 'N-Queens — Count', difficulty: 'hard', companies: [] },
]

/**
 * Invented history. Cold and helped are kept apart here exactly as they are
 * everywhere else — a demo that flattened them would be showing off the one
 * thing this tool refuses to do.
 */
export const DEMO_HISTORY_ROWS = [
  { date: '2026-07-14', problem: 'contains-duplicate', solved: true, hints: 0, time: '06:12', note: 'straight through' },
  { date: '2026-07-14', problem: 'reverse-string', solved: true, hints: 0, time: '04:40', note: '' },
  { date: '2026-07-21', problem: 'valid-anagram', solved: true, hints: 0, time: '11:03', note: 'counted twice, then saw it' },
  { date: '2026-07-21', problem: 'two-sum-sorted', solved: true, hints: 2, time: '18:55', note: 'needed the approach' },
  { date: '2026-08-02', problem: 'valid-palindrome', solved: true, hints: 0, time: '09:31', note: '' },
  { date: '2026-08-02', problem: 'container-with-most-water', solved: true, hints: 1, time: '22:10', note: 'nudge was enough' },
  { date: '2026-08-09', problem: 'longest-substring-no-repeat', solved: false, hints: 3, time: '31:00', note: 'ran out of road' },
  { date: '2026-08-11', problem: 'lru-cache', solved: true, hints: 1, time: '27:44', note: 'map ordering, eventually' },
]

const cold = DEMO_HISTORY_ROWS.filter((r) => r.solved && r.hints === 0).length
const solved = DEMO_HISTORY_ROWS.filter((r) => r.solved).length

export const DEMO_SUMMARY = {
  attempted: DEMO_HISTORY_ROWS.length,
  solved,
  cold,
  // Never a single headline figure. AGENTS.md: "a solve that took four hints is
  // a different fact from a cold solve, and the log is useless if it flattens
  // them." The demo exists to show the tool off, and that distinction is the
  // thing worth showing.
  helped: solved - cold,
}

const tier = (d: DemoProblem['difficulty']) => DEMO_PROBLEMS.filter((p) => p.difficulty === d)

export const DEMO_BY_DIFFICULTY = (['warmup', 'easy', 'medium', 'hard'] as const).map((difficulty) => {
  const problems = tier(difficulty)
  const rowFor = (slug: string) => DEMO_HISTORY_ROWS.find((r) => r.problem === slug)
  return {
    difficulty,
    cold: problems.filter((p) => rowFor(p.slug)?.solved === true && rowFor(p.slug)?.hints === 0).length,
    helped: problems.filter((p) => rowFor(p.slug)?.solved === true && (rowFor(p.slug)?.hints ?? 0) > 0).length,
    unsolved: problems.filter((p) => rowFor(p.slug)?.solved === false).length,
    unattempted: problems.filter((p) => rowFor(p.slug) === undefined).length,
    total: problems.length,
  }
})

/**
 * The roadmap, under the same rule the real one follows: a pattern is named
 * only for a problem with a logged attempt, and everything else is anonymous.
 *
 * Kept even though the history here is invented, because the demo's job is to
 * show what the tool does — and what it does is refuse to name the pattern of
 * a problem you have not tried.
 */
export const DEMO_ROADMAP = [
  {
    pattern: 'hashmap-counting',
    problems: [
      { slug: 'contains-duplicate', title: 'Contains Duplicate', attempted: true, cold: true },
      { slug: 'valid-anagram', title: 'Valid Anagram', attempted: true, cold: true },
    ],
  },
  {
    pattern: 'two-pointers',
    problems: [
      { slug: 'two-sum-sorted', title: 'Two Sum, Sorted', attempted: true, cold: false },
      { slug: 'valid-palindrome', title: 'Valid Palindrome', attempted: true, cold: true },
      { slug: 'container-with-most-water', title: 'Container With Most Water', attempted: true, cold: false },
    ],
  },
  {
    pattern: null,
    problems: [
      { slug: 'reverse-string', title: 'Reverse String', attempted: true, cold: true },
      { slug: 'count-islands', title: 'Number of Islands', attempted: false, cold: false },
      { slug: 'n-queens-count', title: 'N-Queens — Count', attempted: false, cold: false },
    ],
  },
]

export const DEMO_RUST = { slug: 'longest-substring-no-repeat', why: 'never solved cold' }
