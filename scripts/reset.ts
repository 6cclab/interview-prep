import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const DEFAULT_ROOT = 'problems'

function problemDirs(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const pattern of readdirSync(root)) {
    const patternDir = join(root, pattern)
    if (!statSync(patternDir).isDirectory()) continue
    for (const problem of readdirSync(patternDir)) {
      const problemDir = join(patternDir, problem)
      if (statSync(problemDir).isDirectory()) found.push(problemDir)
    }
  }
  return found
}

/**
 * The one problem directory a name refers to, or a throw explaining why not.
 *
 * Exported so the CLI can archive the attempt *before* `resetProblem` writes
 * over it — archiving and resetting are deliberately two functions rather than
 * one with a flag. `resetProblem` is called by tests with a temp `root`, and if
 * it archived by default those tests would write into the real, gitignored
 * `local/attempts/`. Keeping the write in the CLI means no test can reach it.
 */
export function resolveProblemDir(name: string, root: string = DEFAULT_ROOT): string {
  const matches = problemDirs(root).filter(
    (dir) => basename(dir) === name || dir === join(root, name),
  )

  if (matches.length === 0) {
    throw new Error(`No problem named "${name}" under ${root}/`)
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous problem name "${name}" — matches ${matches.join(', ')}. ` +
        `Pass the pattern too, e.g. elimination/${name}.`,
    )
  }
  return matches[0]!
}

/**
 * `YYYY-MM-DD-HHMM` in **local** time.
 *
 * The same shape `voice/transcript.ts` stamps transcripts with, but not the same
 * clock: that one is UTC, and an attempt filed at 19:42 came out stamped `2342`.
 * This directory is browsed by hand between drills, so `voice/coached.ts`'s rule
 * governs — "a session at 9pm should file under the day it felt like." On a late
 * evening the UTC version disagrees with the `coached.md` row about the *date*,
 * not just the hour, for two artifacts from one session.
 */
export function isoStamp(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}`
}

/**
 * Keep a copy of the attempt before the stub goes back over it.
 *
 * **The filename carries the slug and never the pattern**, and it is flat rather
 * than nested under `problems/<pattern>/`. That is the same rule
 * `voice/transcript.ts` follows for coaching transcripts, for the same reason
 * stated there: the pattern is the answer, so a path naming it would spoil every
 * future re-drill of that problem at a glance — and this directory is meant to be
 * browsed between drills.
 *
 * Returns the relative path written, or null when there was nothing worth
 * keeping: an attempt identical to the stub is not history, it is an empty file
 * with a date on it.
 *
 * Never throws. A failed archive must not stop a reset — the reset is the thing
 * that was asked for, and refusing to do it because a copy could not be filed
 * would be the wrong trade.
 */
export function archiveAttempt(problemDir: string, repoRoot: string, at: Date): string | null {
  const solution = join(problemDir, 'solution.ts')
  const stub = join(problemDir, 'stub.ts')
  if (!existsSync(solution)) return null

  try {
    const body = readFileSync(solution, 'utf8')
    if (existsSync(stub) && readFileSync(stub, 'utf8') === body) return null

    const slug = basename(problemDir)
    mkdirSync(join(repoRoot, 'local/attempts'), { recursive: true })

    // Two resets in the same minute share a stamp, so the suffix is what keeps
    // the second from silently replacing the first — same concern as
    // `writeSession`'s refusal to overwrite.
    let relPath = `local/attempts/${slug}-${isoStamp(at)}.ts`
    for (let n = 2; existsSync(join(repoRoot, relPath)); n += 1) {
      relPath = `local/attempts/${slug}-${isoStamp(at)}-${n}.ts`
    }

    const header = [
      `// ${slug} — attempt archived ${at.toISOString()}`,
      '//',
      '// Your own working file, kept before `pnpm reset` restored the stub.',
      '// The pattern is deliberately not recorded here or in the filename, so',
      '// reading this back does not spoil a re-drill of the same problem.',
      '',
    ].join('\n')

    writeFileSync(join(repoRoot, relPath), `${header}${body}`, 'utf8')
    return relPath
  } catch (error) {
    console.error(`Could not archive the attempt in ${problemDir}:`, error)
    return null
  }
}

/**
 * Restore a problem's pristine stub over the working solution file, so the
 * drill can be attempted again from scratch.
 *
 * Does not archive — see `archiveAttempt`, which the CLI calls first.
 *
 * @returns the resolved problem directory
 */
export function resetProblem(name: string, root: string = DEFAULT_ROOT): string {
  const dir = resolveProblemDir(name, root)
  const stub = join(dir, 'stub.ts')
  if (!existsSync(stub)) {
    throw new Error(`Cannot reset ${dir}: no stub.ts to restore from.`)
  }

  copyFileSync(stub, join(dir, 'solution.ts'))
  return dir
}

const isCli = process.argv[1]?.endsWith('reset.ts')
if (isCli) {
  const name = process.argv[2]
  if (!name) {
    console.error('Usage: pnpm reset <problem>')
    process.exit(1)
  }
  try {
    // Archive first, then reset — the other order destroys the thing being kept.
    const dir = resolveProblemDir(name)
    const archived = archiveAttempt(dir, process.cwd(), new Date())
    resetProblem(name)
    if (archived) console.log(`Kept your attempt at ${archived}`)
    else console.log('Nothing to keep — the solution file already matched the stub.')
    console.log(`Reset ${dir}/solution.ts from stub.ts`)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
