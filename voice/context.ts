import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Track = 'mock' | 'design'

/**
 * Paths the interviewer must never see. `.claude/rules/no-spoilers.md` states
 * these as instructions to a reader; here they are a runtime invariant, because
 * a drill is destroyed the moment the answer enters context.
 */
const DENIED = [/^solutions\//, /^patterns\.md$/, /(^|\/)reference\.md$/]

/**
 * Throw if any path is a spoiler. Called on every allowlist before it is read,
 * so widening the allowlist by mistake fails loudly instead of silently leaking.
 */
export function assertNoSpoilers(paths: string[]): void {
  for (const path of paths) {
    if (DENIED.some((pattern) => pattern.test(path))) {
      throw new Error(`Refusing to read spoiler file into an interview: ${path}`)
    }
  }
}

export function allowedPaths(track: Track, problem?: string): string[] {
  if (track === 'mock') {
    return [
      '.claude/commands/mock.md',
      'behavioral/competencies.md',
      'behavioral/questions.md',
    ]
  }
  if (!problem) throw new Error('A design drill needs a problem name.')
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

  const sections = paths.map(
    (path) => `<file path="${path}">\n${readFileSync(join(root, path), 'utf8')}\n</file>`,
  )

  if (track === 'mock') {
    const { all, covered } = competencyCoverage(root)
    const lines = all.map((c) => `- ${c}${covered.includes(c) ? '' : ' (no story yet)'}`)
    sections.push(`<competency-coverage>\n${lines.join('\n')}\n</competency-coverage>`)
  }

  sections.push(
    [
      '<voice-mode>',
      'This interview is spoken aloud. Your text is read by a speech synthesiser',
      'and heard, not seen. Write plain prose only: no markdown, no bullet lists,',
      'no code blocks, no headings. Numbers and symbols must be spelled the way',
      'you would say them.',
      '',
      'You have no tools and no file access. Everything you are permitted to know',
      'is above. Do not ask for a file and do not claim to have read one.',
      '</voice-mode>',
    ].join('\n'),
  )

  return sections.join('\n\n')
}
