import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TEMPLATES = 'templates/local'
const DEST = 'local'

/**
 * Seed the gitignored `local/` directory from committed templates.
 * Existing files are never overwritten — this is safe to re-run.
 *
 * @returns the relative paths actually created
 */
export function seedLocal(templatesDir: string, destDir: string): string[] {
  mkdirSync(destDir, { recursive: true })

  const created: string[] = []
  for (const entry of readdirSync(templatesDir)) {
    const from = join(templatesDir, entry)
    if (!statSync(from).isFile()) continue
    const to = join(destDir, entry)
    if (existsSync(to)) continue
    copyFileSync(from, to)
    created.push(entry)
  }
  return created
}

/**
 * Set `candidate_name` in an already-seeded config.
 *
 * Rewrites the key in place when present and appends it when not, so it works
 * on a config the user has already edited. Returns whether anything changed.
 */
export function setCandidateName(destDir: string, name: string): boolean {
  const path = join(destDir, 'config.yaml')
  if (!existsSync(path)) return false
  const before = readFileSync(path, 'utf8')
  const line = `candidate_name: ${name}`
  const after = /^candidate_name:.*$/m.test(before)
    ? before.replace(/^candidate_name:.*$/m, line)
    : `${before.trimEnd()}\n${line}\n`
  if (after === before) return false
  writeFileSync(path, after)
  return true
}

const isCli = process.argv[1]?.endsWith('bootstrap.ts')
if (isCli) {
  const created = seedLocal(TEMPLATES, DEST)
  if (created.length === 0) {
    console.log(`local/ is already set up — nothing to do.`)
  } else {
    console.log(`Created in local/: ${created.join(', ')}`)
    console.log(`Edit local/config.yaml if job-search lives somewhere unusual.`)
  }

  const nameFlag = process.argv.indexOf('--name')
  const name = nameFlag === -1 ? undefined : process.argv[nameFlag + 1]
  if (name !== undefined && name.trim() !== '' && setCandidateName(DEST, name.trim())) {
    console.log(`Drills will call you "${name.trim()}".`)
  }
}
