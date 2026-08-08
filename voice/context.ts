import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

export type Track = 'mock' | 'design'

/**
 * Paths the interviewer must never see. `.claude/rules/no-spoilers.md` states
 * these as instructions to a reader; here they are a runtime invariant, because
 * a drill is destroyed the moment the answer enters context. Case-insensitive:
 * macOS filesystems are case-insensitive by default, so `Patterns.MD` must be
 * caught too.
 */
const DENIED = [/^solutions\//i, /^patterns\.md$/i, /(^|\/)reference\.md$/i]

/**
 * Throw if any path is a spoiler. Called on every allowlist before it is read,
 * so widening the allowlist by mistake fails loudly instead of silently leaking.
 *
 * This is the last line of defence, so it does not trust its callers: every
 * path is normalized before being tested against `DENIED`, and any path that
 * is absolute or escapes upward (a `..` segment surviving normalization) is
 * rejected outright, whether or not it happens to match a `DENIED` pattern.
 */
export function assertNoSpoilers(paths: string[]): void {
  for (const path of paths) {
    const normalized = normalize(path)
    const segments = normalized.split(sep)
    const escapesRoot = normalized.startsWith('/') || segments.includes('..')
    if (escapesRoot || DENIED.some((pattern) => pattern.test(normalized))) {
      throw new Error(`Refusing to read spoiler file into an interview: ${path}`)
    }
  }
}

const PROBLEM_SLUG = /^[a-z0-9-]+$/

export function allowedPaths(track: Track, problem?: string): string[] {
  if (track === 'mock') {
    return [
      '.claude/commands/mock.md',
      'behavioral/competencies.md',
      'behavioral/questions.md',
    ]
  }
  if (!problem) throw new Error('A design drill needs a problem name.')
  if (!PROBLEM_SLUG.test(problem)) {
    throw new Error(`Invalid problem name: ${problem}`)
  }
  return [
    '.claude/commands/design.md',
    `system-design/${problem}/README.md`,
    `system-design/${problem}/rubric.md`,
  ]
}

function headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
}

/**
 * Which competencies have a story and which do not — headings only.
 *
 * `mock.md` says to consult the story bank *only* to find gaps, never to read
 * the story being asked for. Parsing headings makes that mechanical: the bodies
 * never leave this function.
 */
export function competencyCoverage(root: string): { all: string[]; covered: string[] } {
  const all = headings(readFileSync(join(root, 'behavioral/competencies.md'), 'utf8'))
  const bank = join(root, 'local/stories.md')
  const covered = existsSync(bank) ? headings(readFileSync(bank, 'utf8')) : []
  return { all, covered }
}

export function buildSystemPrompt(root: string, track: Track, problem?: string): string {
  const paths = allowedPaths(track, problem)
  assertNoSpoilers(paths)

  const sections = paths.map((path) => {
    const full = join(root, path)
    if (!existsSync(full)) {
      const label = problem ? ` "${problem}"` : ''
      throw new Error(`Unknown problem${label}: missing expected file ${path}`)
    }
    return `<file path="${path}">\n${readFileSync(full, 'utf8')}\n</file>`
  })

  if (track === 'mock') {
    const { all, covered } = competencyCoverage(root)
    const lines = all.map((c) => `- ${c}${covered.includes(c) ? '' : ' (no story yet)'}`)
    sections.push(`<competency-coverage>\n${lines.join('\n')}\n</competency-coverage>`)
  }

  const voiceMode = [
    '<voice-mode>',
    'This interview is spoken aloud. Your text is read by a speech synthesiser',
    'and heard, not seen. Write plain prose only: no markdown, no bullet lists,',
    'no code blocks, no headings. Numbers and symbols must be spelled the way',
    'you would say them.',
    '',
    'You have no tools and no file access. Everything you are permitted to know',
    'is above. Do not ask for a file and do not claim to have read one.',
  ]

  if (track === 'mock') {
    voiceMode.push(
      '',
      'Step 6 above tells you to append to local/stories.md. You cannot write',
      'files, so replace that step: after you critique a behavioral answer, end',
      'your turn with this block, exactly as shown, in place of the file write:',
      '',
      '```story-log',
      'competency: <the competency>',
      'story: <the story he used>',
      'worked: <what worked>',
      'fix: <the one thing to fix>',
      '```',
      '',
      'This is the one exception to no code blocks. It is stripped before your',
      'words reach him — do not speak it, name it, or introduce it.',
    )
  }

  if (track === 'design') {
    // design.md's live mode step 6 ends by saving the transcript and score to
    // local/designs/. You cannot write files, and the same gap on the mock
    // track (a step whose file write was never replaced with anything) left the
    // whole scoring step quietly undone. The server persists everything spoken,
    // so the replacement is simply: say it.
    voiceMode.push(
      '',
      'Step 6 above tells you to save the transcript and score to a file. You',
      'cannot write files, and you do not need to — everything you say is being',
      'recorded and saved for him. So when time is up, deliver the score out',
      'loud as your final turn: each rubric dimension and its rating, the',
      'evidence in his own words, the weakest dimension, and one next action.',
      '',
      'You have no clock of your own. Each turn you are given is preceded by a',
      'time check telling you how long remains. Trust it over your own sense of',
      'how long the conversation feels, and treat the time check as instruction',
      'to you, not as something he said — never read it aloud or refer to being',
      'told it.',
    )
  }

  voiceMode.push('</voice-mode>')
  sections.push(voiceMode.join('\n'))

  return sections.join('\n\n')
}

/** The live design track's budget, per `design.md`: "45 minutes unless he says otherwise." */
export const DESIGN_BUDGET_MS = 45 * 60 * 1000

/**
 * The per-turn time check fed to a design interviewer (see `CreateSessionOptions.turnCue`).
 *
 * Phrased as an instruction to the interviewer rather than as data, because it
 * arrives in the `user` slot where everything else is Andre speaking, and the
 * one failure that would ruin a drill is the interviewer reading it out as
 * though he had said it. `design.md` drives the behaviour — the warning at ten
 * minutes and stopping at time — so this only supplies the number, and states
 * the deadline plainly at zero so "at time, stop" has an unambiguous trigger.
 */
export function designTimeCue(elapsedMs: number, budgetMs: number = DESIGN_BUDGET_MS): string {
  const remainingMs = budgetMs - elapsedMs
  if (remainingMs <= 0) {
    return '[Time check, for you only: time is up. Stop the interview now and deliver the score.]'
  }
  // Rounded up, so a cue never says "0 minutes remain" while time is still left.
  const minutes = Math.ceil(remainingMs / 60_000)
  const unit = minutes === 1 ? 'minute' : 'minutes'
  return `[Time check, for you only: ${minutes} ${unit} of the ${Math.round(budgetMs / 60_000)} remain.]`
}
