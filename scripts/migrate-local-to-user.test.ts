import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateLocalToUser } from './migrate-local-to-user'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'migrate-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function seedLocal(files: Record<string, string>) {
  const local = join(root, 'local')
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(local, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
  }
  return local
}

describe('migrateLocalToUser', () => {
  it('moves top-level files and directories from local/ into local/users/<uid>/', () => {
    seedLocal({
      'drill-log.md': 'drills',
      'coached.md': 'coached',
      'stories.md': 'stories',
      'config.yaml': 'config',
      'voice.json': '{}',
      'attempts/celebrity-2026-08-10-1939.ts': 'attempt',
      'drills/foo.md': 'drill',
      'coaching/bar.md': 'coaching',
      'designs/baz.md': 'design',
      'debugging/qux.md': 'debug',
      'companies/acme.md': 'company',
    })

    migrateLocalToUser(root, 'andre')

    const dest = join(root, 'local/users/andre')
    expect(readFileSync(join(dest, 'drill-log.md'), 'utf8')).toBe('drills')
    expect(readFileSync(join(dest, 'coached.md'), 'utf8')).toBe('coached')
    expect(readFileSync(join(dest, 'stories.md'), 'utf8')).toBe('stories')
    expect(readFileSync(join(dest, 'config.yaml'), 'utf8')).toBe('config')
    expect(readFileSync(join(dest, 'voice.json'), 'utf8')).toBe('{}')
    expect(readFileSync(join(dest, 'attempts/celebrity-2026-08-10-1939.ts'), 'utf8')).toBe('attempt')
    expect(readFileSync(join(dest, 'drills/foo.md'), 'utf8')).toBe('drill')
    expect(readFileSync(join(dest, 'coaching/bar.md'), 'utf8')).toBe('coaching')
    expect(readFileSync(join(dest, 'designs/baz.md'), 'utf8')).toBe('design')
    expect(readFileSync(join(dest, 'debugging/qux.md'), 'utf8')).toBe('debug')
    expect(readFileSync(join(dest, 'companies/acme.md'), 'utf8')).toBe('company')

    // Originals are gone from local/ (moved, not copied).
    expect(existsSync(join(root, 'local/drill-log.md'))).toBe(false)
    expect(existsSync(join(root, 'local/attempts'))).toBe(false)
  })

  it('does not move local/certs/ — it belongs to the machine, not a person', () => {
    seedLocal({ 'certs/rootCA.pem': 'cert', 'drill-log.md': 'drills' })

    migrateLocalToUser(root, 'andre')

    expect(readFileSync(join(root, 'local/certs/rootCA.pem'), 'utf8')).toBe('cert')
    expect(existsSync(join(root, 'local/users/andre/certs'))).toBe(false)
  })

  it('never moves local/users/ into itself', () => {
    seedLocal({ 'drill-log.md': 'drills' })
    mkdirSync(join(root, 'local/users/someone-else'), { recursive: true })
    writeFileSync(join(root, 'local/users/someone-else/stories.md'), 'existing')

    migrateLocalToUser(root, 'andre')

    // The pre-existing users/ tree survives untouched, not nested into itself.
    expect(readFileSync(join(root, 'local/users/someone-else/stories.md'), 'utf8')).toBe('existing')
    expect(existsSync(join(root, 'local/users/andre/users'))).toBe(false)
  })

  it('is idempotent: a second run is a no-op that does not throw', () => {
    seedLocal({ 'drill-log.md': 'drills' })

    migrateLocalToUser(root, 'andre')
    expect(() => migrateLocalToUser(root, 'andre')).not.toThrow()

    expect(readFileSync(join(root, 'local/users/andre/drill-log.md'), 'utf8')).toBe('drills')
  })

  it('re-running after local/ is repopulated skips existing destination entries rather than clobbering', () => {
    seedLocal({ 'drill-log.md': 'original' })
    migrateLocalToUser(root, 'andre')

    // Simulate a fresh drill-log.md reappearing at the source with newer content.
    writeFileSync(join(root, 'local/drill-log.md'), 'newer')
    const summary = migrateLocalToUser(root, 'andre')

    expect(readFileSync(join(root, 'local/users/andre/drill-log.md'), 'utf8')).toBe('original')
    expect(summary.skipped).toContain('drill-log.md')
  })

  it('never moves local/users/ into the destination on a re-run guard', () => {
    seedLocal({ 'drill-log.md': 'drills' })
    migrateLocalToUser(root, 'andre')

    expect(() => migrateLocalToUser(root, 'andre')).not.toThrow()
    expect(existsSync(join(root, 'local/users/andre/users'))).toBe(false)
  })

  it('returns a summary of what moved and what was skipped', () => {
    seedLocal({ 'drill-log.md': 'drills', 'stories.md': 'stories' })
    mkdirSync(join(root, 'local/users/andre'), { recursive: true })
    writeFileSync(join(root, 'local/users/andre/stories.md'), 'already here')

    const summary = migrateLocalToUser(root, 'andre')

    expect(summary.moved).toContain('drill-log.md')
    expect(summary.skipped).toContain('stories.md')
    expect(summary.moved).not.toContain('stories.md')
  })

  it('returns an empty summary when local/ does not exist — a fresh clone has none', () => {
    const summary = migrateLocalToUser(root, 'andre')
    expect(summary.moved).toEqual([])
    expect(summary.skipped).toEqual([])
    expect(existsSync(join(root, 'local'))).toBe(false)
  })

  it('propagates userDataDir\'s own throw for an invalid user id, without reimplementing validation', () => {
    seedLocal({ 'drill-log.md': 'drills' })
    expect(() => migrateLocalToUser(root, '../escape')).toThrow(/invalid user id/i)
  })
})
