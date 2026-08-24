import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSolution, writeSolution, versionOf } from './solution-file'

/** A temp repo root holding one problem, so nothing here touches the real tree. */
function root(body = 'export function solve() {}\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'solution-file-'))
  const problem = join(dir, 'problems/two-pointers/valid-palindrome')
  mkdirSync(problem, { recursive: true })
  writeFileSync(join(problem, 'solution.ts'), body)
  writeFileSync(join(problem, 'meta.yaml'), 'pattern: two-pointers\ndifficulty: warmup\n')
  writeFileSync(join(problem, 'README.md'), '# Valid palindrome\n')
  writeFileSync(join(problem, 'solution.test.ts'), '')
  writeFileSync(join(problem, 'stub.ts'), body)
  return dir
}

describe('readSolution', () => {
  it('returns the file text and a version', () => {
    const got = readSolution(root(), 'valid-palindrome')
    expect(got?.text).toBe('export function solve() {}\n')
    expect(got?.version).toEqual(expect.any(String))
    expect(got?.version).not.toBe('')
  })

  it('returns null for a slug that resolves to no problem', () => {
    expect(readSolution(root(), 'no-such-problem')).toBeNull()
  })
})

describe('versionOf', () => {
  it('is stable for identical content and different for changed content', () => {
    expect(versionOf('a')).toBe(versionOf('a'))
    expect(versionOf('a')).not.toBe(versionOf('b'))
  })

  // Whitespace-only edits are real edits — a version that ignored them would
  // let one writer silently overwrite another's reformatting.
  it('distinguishes a trailing newline', () => {
    expect(versionOf('a')).not.toBe(versionOf('a\n'))
  })
})

describe('writeSolution', () => {
  it('writes when the expected version matches', () => {
    const dir = root()
    const before = readSolution(dir, 'valid-palindrome')!
    expect(writeSolution(dir, 'valid-palindrome', 'const x = 1\n', before.version)).toBe('ok')
    expect(readFileSync(join(dir, 'problems/two-pointers/valid-palindrome/solution.ts'), 'utf8'))
      .toBe('const x = 1\n')
  })

  // The whole point of the guard: a second writer must be told, not obeyed.
  it('refuses and leaves the file alone when the version is stale', () => {
    const dir = root()
    const stale = versionOf('something else entirely')
    expect(writeSolution(dir, 'valid-palindrome', 'const x = 1\n', stale)).toBe('stale')
    expect(readFileSync(join(dir, 'problems/two-pointers/valid-palindrome/solution.ts'), 'utf8'))
      .toBe('export function solve() {}\n')
  })

  it('reports a missing problem rather than creating one', () => {
    expect(writeSolution(root(), 'no-such-problem', 'x', versionOf('x'))).toBe('missing')
  })
})
