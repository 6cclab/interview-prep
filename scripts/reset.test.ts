import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetProblem } from './reset'

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
