import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEM_SLUG } from './context'
import type { ProblemLocation } from './problems'

/**
 * The AI-assisted coding track.
 *
 * Added 2026-08-21 for the Talkspace round, where the recruiter's scheduling
 * email asks the candidate to have an AI coding CLI available and to use it. It
 * is the first track in this repo where help is unlimited by design, which is
 * why it does not touch the hint ladder at all: rationing hints to a candidate
 * who has Claude Code open in the next window rations nothing.
 *
 * What moves instead is the thing being scored. Solo drilling measures
 * time-to-working-code; this measures whether he framed the problem before
 * delegating it, said what he expected back, and verified what he got. See
 * `prompts/assisted.md`.
 *
 * He works in `local/assisted/<slug>/`, a real directory on disk rather than an
 * editor inside the app, because the format being rehearsed has him in his own
 * terminal with his own tool.
 */

/**
 * Where he works. Under `local/`, which is gitignored, alongside
 * `local/attempts/` and `local/drills/` — an attempt is his, not the repo's.
 */
export function assistedDir(root: string, slug: string): string {
  if (!PROBLEM_SLUG.test(slug)) throw new Error(`Invalid problem name: ${slug}`)
  return join(root, 'local', 'assisted', slug)
}

/**
 * Files the interviewer must not be shown, whatever is in the directory.
 *
 * The suite is excluded for the reason the coding track already excludes it
 * (`allowedPaths`, voice/context.ts): "its comments explain fixture construction,
 * and they have leaked an approach once already." He needs the suite on disk to
 * run it; the interviewer needs the verdict, not the file.
 *
 * Dotfiles are excluded because the drill directory carries a `.claude/`
 * settings file whose whole purpose is to be machinery — see `seedAssistedDir`.
 */
function isReadable(name: string): boolean {
  if (name.startsWith('.')) return false
  if (name === 'node_modules') return false
  // Scaffolding this module wrote, not work he did. Excluded because the cue is
  // re-sent every turn: leaving them in would re-read the agent brief and the
  // whole problem statement on every single turn, which is per-turn spend for
  // content the interviewer already has in its system prompt.
  if (SEEDED.has(name)) return false
  return !/\.test\.tsx?$/.test(name)
}

const SEEDED = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md'])

/**
 * The per-turn budget for the working directory, in characters.
 *
 * The cue is re-sent every turn, so an unbounded directory is an unbounded
 * per-turn spend that grows as he works — the same cost `coach.ts` names for a
 * single file, multiplied by however many files a coding agent decided to
 * create. Truncation is announced in the cue rather than silent, because an
 * interviewer that has seen half a file and does not know it will confidently
 * discuss the half it has.
 */
const CUE_BUDGET = 40_000

export interface WorkingFile {
  name: string
  source: string
}

/**
 * The working directory as it stands right now, or `null` if it is not there.
 *
 * Non-recursive on purpose. A flat drill directory is what `seedAssistedDir`
 * creates, and walking a tree that an agent may have filled with anything is a
 * different job with a different failure mode.
 */
export function readAssistedDir(root: string, slug: string): WorkingFile[] | null {
  const dir = assistedDir(root, slug)
  if (!existsSync(dir)) return null
  let names: string[]
  try {
    names = readdirSync(dir).filter(isReadable).sort()
  } catch {
    return null
  }
  const files: WorkingFile[] = []
  for (const name of names) {
    const full = join(dir, name)
    try {
      if (!statSync(full).isFile()) continue
      files.push({ name, source: readFileSync(full, 'utf8') })
    } catch {
      // A file that vanished or is unreadable between the listing and the read.
      // Skipping it is right: the cue is a snapshot, not a transaction.
    }
  }
  return files
}

/**
 * The working directory, framed for the interviewer.
 *
 * Same slot and same framing as `coach.ts`'s `codeCue` — an aside in the turn
 * where everything else is the candidate speaking, so a model cannot mistake it
 * for something he said. The empty and missing cases are stated explicitly for
 * the reason given there: an interviewer that silently receives nothing starts
 * guessing at code that is not there.
 */
export function assistedCue(files: WorkingFile[] | null): string {
  if (files === null) {
    return (
      '[For you only, not spoken: his working directory could not be read. Do not guess ' +
      'at what it contains and do not describe code you have not seen — ask him what he ' +
      'has so far.]'
    )
  }
  const written = files.filter((f) => f.source.trim() !== '')
  if (written.length === 0) {
    return (
      '[For you only, not spoken: his working directory is empty. He has not written ' +
      'anything yet.]'
    )
  }

  const blocks: string[] = []
  let spent = 0
  let truncated = false
  for (const file of written) {
    const remaining = CUE_BUDGET - spent
    if (remaining <= 0) {
      truncated = true
      break
    }
    const body =
      file.source.length > remaining ? `${file.source.slice(0, remaining)}\n... [truncated]` : file.source
    if (file.source.length > remaining) truncated = true
    spent += body.length
    blocks.push(`<file name="${file.name}">\n\`\`\`ts\n${body}\n\`\`\`\n</file>`)
  }

  return [
    '[For you only, not spoken: this is his working directory as it stands right now.',
    'It is the current state, not a message from him — do not read it aloud, do not',
    'quote it back at length, and do not react to it unless it is relevant to what he',
    truncated
      ? 'just said. Some of it was too long to include and has been truncated; do not treat what you have as the whole file.]'
      : 'just said.]',
    '',
    ...blocks,
  ].join('\n')
}

/**
 * The instructions dropped into the drill directory for *his* coding agent.
 *
 * This is the hazard the track introduces and the repo had no defence against,
 * because until now the interviewer was the only agent it had to sandbox. His
 * Claude Code, run with a cwd inside this repo, can walk up and read
 * `solutions/` and `patterns.md` — which would void the drill silently.
 *
 * The settings file is real enforcement; this file is advisory. Both are here
 * because they fail differently.
 */
const AGENT_BRIEF = `# Drill working directory

You are helping with a timed interview drill. Work only inside this directory.

Do NOT read anything outside it — in particular \`solutions/\`, \`patterns.md\`,
or any \`reference.md\` anywhere in the parent repository. Those contain worked
answers to this exact problem. Reading them does not help; it ends the drill.

The problem statement is in \`README.md\`. Write your work in \`solution.ts\`.
Run the suite with \`pnpm vitest run local/assisted\` from the repository root.
`

/**
 * `permissions.deny` covering the three spoiler shapes `assertNoSpoilers` denies
 * for the interviewer, applied here to his own agent. Deliberately the same
 * three, so widening one and forgetting the other is a visible inconsistency
 * rather than a silent gap.
 */
const AGENT_SETTINGS = {
  permissions: {
    deny: [
      'Read(//**/solutions/**)',
      'Read(//**/patterns.md)',
      'Read(//**/reference.md)',
    ],
  },
}

/**
 * Create the working directory for an attempt and seed it.
 *
 * Idempotent on the scaffolding and **non-destructive on his work**: an existing
 * `solution.ts` is never overwritten. Restarting a session after a crash must not
 * be the thing that deletes twenty minutes of work, and this is the only function
 * in the track that writes anything he could lose.
 */
export function seedAssistedDir(root: string, problem: ProblemLocation): string {
  const dir = assistedDir(root, problem.slug)
  mkdirSync(join(dir, '.claude'), { recursive: true })

  const readme = join(root, 'problems', problem.pattern, problem.slug, 'README.md')
  if (existsSync(readme)) {
    writeFileSync(join(dir, 'README.md'), readFileSync(readme, 'utf8'))
  }

  const suite = join(root, 'problems', problem.pattern, problem.slug, 'solution.test.ts')
  if (existsSync(suite)) {
    writeFileSync(join(dir, 'solution.test.ts'), readFileSync(suite, 'utf8'))
  }

  writeFileSync(join(dir, 'AGENTS.md'), AGENT_BRIEF)
  writeFileSync(join(dir, 'CLAUDE.md'), AGENT_BRIEF)
  writeFileSync(join(dir, '.claude', 'settings.json'), `${JSON.stringify(AGENT_SETTINGS, null, 2)}\n`)

  const solution = join(dir, 'solution.ts')
  if (!existsSync(solution)) {
    const stub = join(root, 'problems', problem.pattern, problem.slug, 'solution.ts')
    writeFileSync(solution, existsSync(stub) ? readFileSync(stub, 'utf8') : '')
  }

  return dir
}
