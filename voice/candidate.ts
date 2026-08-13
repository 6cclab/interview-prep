import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from './user-root'

/**
 * Who the drill is for.
 *
 * The prompts and rules addressed one person by name, and the prompts are model
 * input — so an un-parameterised name means the interviewer greets whoever
 * cloned the repo as somebody else.
 *
 * Substitution happens when the prompt is assembled, never on disk. Rewriting
 * the committed files at bootstrap would put a name into `git status` as a diff
 * against every prompt, which is a worse problem than the one being solved.
 */
export const CANDIDATE_TOKEN = '{{candidate}}'

/** Neutral, and grammatical everywhere the token appears. */
export const DEFAULT_CANDIDATE = 'the candidate'

// Single-key read rather than a YAML parser, matching `voice/exercises.ts`,
// `voice/problems.ts` and `scripts/domains.ts`. Adding a dependency to read one
// string would be the only runtime dependency this repo has for config.
const NAME_LINE = /^candidate_name:\s*(.*)$/m

export function readCandidateName(root: string, userId: string | null): string {
  const path = join(userDataDir(root, userId), 'config.yaml')
  if (!existsSync(path)) return DEFAULT_CANDIDATE
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return DEFAULT_CANDIDATE
  }
  const raw = NAME_LINE.exec(text)?.[1]
  if (raw === undefined) return DEFAULT_CANDIDATE
  const value = raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  return value === '' ? DEFAULT_CANDIDATE : value
}

export function renderCandidate(text: string, name: string): string {
  return text.split(CANDIDATE_TOKEN).join(name)
}
