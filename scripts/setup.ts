import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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

const isCli = process.argv[1]?.endsWith('setup.ts')
if (isCli) {
  const created = seedLocal(TEMPLATES, DEST)
  if (created.length === 0) {
    console.log(`local/ is already set up — nothing to do.`)
  } else {
    console.log(`Created in local/: ${created.join(', ')}`)
    console.log(`Edit local/config.yaml if job-search lives somewhere unusual.`)
  }
}
