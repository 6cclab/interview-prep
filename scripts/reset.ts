import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
 * Restore a problem's pristine stub over the working solution file, so the
 * drill can be attempted again from scratch.
 *
 * @returns the resolved problem directory
 */
export function resetProblem(name: string, root: string = DEFAULT_ROOT): string {
  const matches = problemDirs(root).filter(
    (dir) => dir.split('/').at(-1) === name,
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

  const dir = matches[0]!
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
    console.log(`Reset ${resetProblem(name)}/solution.ts from stub.ts`)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
