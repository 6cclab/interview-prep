import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { archiveAttempt, isoStamp, resetProblem, resolveProblemDir } from './reset'

let root: string

function seedProblem(pattern: string, problem: string, stub: string, solution: string) {
  const dir = join(root, pattern, problem)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'stub.ts'), stub)
  writeFileSync(join(dir, 'solution.ts'), solution)
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reset-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resetProblem', () => {
  it('overwrites solution.ts with the contents of stub.ts', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    resetProblem('celebrity', root)
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('STUB')
  })

  it('leaves stub.ts untouched', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    resetProblem('celebrity', root)
    expect(readFileSync(join(dir, 'stub.ts'), 'utf8')).toBe('STUB')
  })

  it('returns the resolved problem directory', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    expect(resetProblem('celebrity', root)).toBe(dir)
  })

  it('finds a problem regardless of which pattern directory holds it', () => {
    seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    const dir = seedProblem('intervals', 'merge-intervals', 'STUB2', 'ANSWER2')
    resetProblem('merge-intervals', root)
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('STUB2')
  })

  it('throws a helpful error for an unknown problem', () => {
    seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    expect(() => resetProblem('does-not-exist', root)).toThrow(/no problem named "does-not-exist"/i)
  })

  it('resolves a qualified pattern/problem form', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    expect(resetProblem('elimination/celebrity', root)).toBe(dir)
  })

  it('throws when the same problem name exists under two patterns', () => {
    seedProblem('elimination', 'duplicate', 'A', 'A')
    seedProblem('intervals', 'duplicate', 'B', 'B')
    expect(() => resetProblem('duplicate', root)).toThrow(/ambiguous/i)
  })

  it('throws when the problem directory has no stub.ts', () => {
    const dir = join(root, 'elimination', 'no-stub')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'solution.ts'), 'MY ANSWER')
    expect(() => resetProblem('no-stub', root)).toThrow(/stub\.ts/)
  })
})

/**
 * `archiveAttempt` writes into `<repoRoot>/local/attempts/`, and every test here
 * passes a temp directory as that root. `local/` in the real repo is gitignored
 * and holds the only copy of his drill history — a test that wrote there would be
 * unrecoverable, which is why the archive lives in the CLI and not inside
 * `resetProblem`.
 */
describe('archiveAttempt', () => {
  const AT = new Date(2026, 7, 10, 19, 39, 0)

  it('keeps the attempt and returns its path', () => {
    const dir = seedProblem('elimination', 'celebrity', 'throw new Error("not implemented")', 'my real work')
    const rel = archiveAttempt(dir, root, AT)
    expect(rel).toBe('local/attempts/celebrity-2026-08-10-1939.ts')
    expect(readFileSync(join(root, rel!), 'utf8')).toContain('my real work')
  })

  it('never names the pattern, in the path or the file', () => {
    // The pattern is the answer, and this directory is browsed between drills.
    const dir = seedProblem('monotonic-stack', 'daily-temperatures', 'stub', 'attempt')
    const rel = archiveAttempt(dir, root, AT)!
    expect(rel).not.toContain('monotonic')
    expect(readFileSync(join(root, rel), 'utf8')).not.toContain('monotonic')
  })

  it('returns null and writes nothing when the attempt matches the stub', () => {
    const dir = seedProblem('elimination', 'celebrity', 'same', 'same')
    expect(archiveAttempt(dir, root, AT)).toBeNull()
    expect(existsSync(join(root, 'local/attempts'))).toBe(false)
  })

  it('returns null when there is no solution file at all', () => {
    const dir = join(root, 'elimination', 'celebrity')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'stub.ts'), 'stub')
    expect(archiveAttempt(dir, root, AT)).toBeNull()
  })

  it('does not overwrite an earlier attempt archived in the same minute', () => {
    const dir = seedProblem('elimination', 'celebrity', 'stub', 'first attempt')
    const first = archiveAttempt(dir, root, AT)!
    writeFileSync(join(dir, 'solution.ts'), 'second attempt')
    const second = archiveAttempt(dir, root, AT)!

    expect(second).not.toBe(first)
    expect(readFileSync(join(root, first), 'utf8')).toContain('first attempt')
    expect(readFileSync(join(root, second), 'utf8')).toContain('second attempt')
    expect(readdirSync(join(root, 'local/attempts'))).toHaveLength(2)
  })

  it('records the slug and the timestamp in a header above the code', () => {
    const dir = seedProblem('elimination', 'celebrity', 'stub', 'const x = 1')
    const body = readFileSync(join(root, archiveAttempt(dir, root, AT)!), 'utf8')
    expect(body).toContain('celebrity')
    expect(body).toContain(AT.toISOString())
    // The code has to survive intact and come after the header, so the file is
    // still valid TypeScript that can be read or pasted back.
    expect(body.trimEnd().endsWith('const x = 1')).toBe(true)
  })
})

describe('resolveProblemDir', () => {
  it('resolves a bare slug to its directory', () => {
    const dir = seedProblem('elimination', 'celebrity', 'stub', 'attempt')
    expect(resolveProblemDir('celebrity', root)).toBe(dir)
  })

  it('throws for an unknown name, so the CLI archives nothing', () => {
    expect(() => resolveProblemDir('nope', root)).toThrow(/no problem named/i)
  })
})

describe('isoStamp', () => {
  // Built from local components, so the assertion holds in any TZ the suite runs
  // in — a UTC literal here would pass only where the offset happens to be zero.
  it('is YYYY-MM-DD-HHMM in local time', () => {
    expect(isoStamp(new Date(2026, 7, 10, 19, 39, 18))).toBe('2026-08-10-1939')
  })

  it('pads single-digit months, days and times', () => {
    expect(isoStamp(new Date(2026, 0, 5, 9, 7, 0))).toBe('2026-01-05-0907')
  })
})
