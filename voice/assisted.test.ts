import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assistedCue, assistedDir, readAssistedDir, seedAssistedDir } from './assisted'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'assisted-'))
  roots.push(root)
  return root
}

function seedProblem(root: string, pattern: string, slug: string, files: Record<string, string>) {
  const dir = join(root, 'problems', pattern, slug)
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('assistedDir', () => {
  it('places the attempt under gitignored local/', () => {
    const root = makeRoot()
    expect(assistedDir(root, 'valid-anagram')).toBe(join(root, 'local', 'assisted', 'valid-anagram'))
  })

  // The same guard every other path-taking function in this repo applies. A slug
  // reaches here off a hash the user can edit by hand.
  it.each(['../solutions', 'Valid-Anagram', 'a b', '', 'foo/bar'])(
    'refuses %j as a problem name',
    (slug) => {
      expect(() => assistedDir(makeRoot(), slug)).toThrow(/Invalid problem name/)
    },
  )
})

describe('seedAssistedDir', () => {
  it('copies the README, the suite and a stub, and writes the agent brief', () => {
    const root = makeRoot()
    seedProblem(root, 'hashmap-counting', 'valid-anagram', {
      'README.md': '# Valid Anagram',
      'solution.test.ts': "import { it } from 'vitest'",
      'solution.ts': 'export function isAnagram() {}',
    })

    const dir = seedAssistedDir(root, { slug: 'valid-anagram', pattern: 'hashmap-counting' })

    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# Valid Anagram')
    expect(readFileSync(join(dir, 'solution.test.ts'), 'utf8')).toBe("import { it } from 'vitest'")
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('export function isAnagram() {}')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toMatch(/Work only inside this directory/)
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toMatch(/Work only inside this directory/)
  })

  // The hazard this track introduces: his own coding agent is not sandboxed by
  // anything in this repo, and a walk up the tree reaches worked answers.
  it('denies his agent the three spoiler shapes the interviewer is denied', () => {
    const root = makeRoot()
    seedProblem(root, 'hashmap-counting', 'valid-anagram', { 'README.md': '# x' })

    const dir = seedAssistedDir(root, { slug: 'valid-anagram', pattern: 'hashmap-counting' })
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'))

    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/solutions/),
        expect.stringMatching(/patterns\.md/),
        expect.stringMatching(/reference\.md/),
      ]),
    )
  })

  // Restarting a session after a crash must not be the thing that deletes his work.
  it('never overwrites an existing solution.ts', () => {
    const root = makeRoot()
    seedProblem(root, 'hashmap-counting', 'valid-anagram', {
      'README.md': '# x',
      'solution.ts': 'export function isAnagram() {}',
    })
    const location = { slug: 'valid-anagram', pattern: 'hashmap-counting' }

    const dir = seedAssistedDir(root, location)
    writeFileSync(join(dir, 'solution.ts'), 'twenty minutes of work')
    seedAssistedDir(root, location)

    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('twenty minutes of work')
  })

  it('survives a problem with no stub to copy', () => {
    const root = makeRoot()
    seedProblem(root, 'hashmap-counting', 'valid-anagram', { 'README.md': '# x' })

    const dir = seedAssistedDir(root, { slug: 'valid-anagram', pattern: 'hashmap-counting' })

    expect(existsSync(join(dir, 'solution.ts'))).toBe(true)
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('')
  })
})

describe('readAssistedDir', () => {
  it('is null before the directory exists', () => {
    expect(readAssistedDir(makeRoot(), 'valid-anagram')).toBeNull()
  })

  it('reads working files in a stable order', () => {
    const root = makeRoot()
    const dir = assistedDir(root, 'valid-anagram')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'solution.ts'), 'SOLUTION')
    writeFileSync(join(dir, 'helper.ts'), 'HELPER')

    expect(readAssistedDir(root, 'valid-anagram')).toEqual([
      { name: 'helper.ts', source: 'HELPER' },
      { name: 'solution.ts', source: 'SOLUTION' },
    ])
  })

  // The coding track withholds the suite from the interviewer because its
  // fixture comments have leaked an approach once already. Same rule here.
  it('withholds the suite, dotfiles and node_modules from the interviewer', () => {
    const root = makeRoot()
    const dir = assistedDir(root, 'valid-anagram')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'solution.ts'), 'SOLUTION')
    writeFileSync(join(dir, 'solution.test.ts'), 'THE SUITE')
    writeFileSync(join(dir, 'CLAUDE.md'), 'brief')
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}')

    const names = readAssistedDir(root, 'valid-anagram')!.map((f) => f.name)

    expect(names).not.toContain('solution.test.ts')
    expect(names).not.toContain('.claude')
    expect(names).not.toContain('node_modules')
    expect(names).toContain('solution.ts')
  })

  // The cue is re-sent every turn, so scaffolding left in it is paid for on every
  // turn — and the interviewer already has the problem statement in its system
  // prompt. Only his work should be in here.
  it('withholds the scaffolding it seeded itself', () => {
    const root = makeRoot()
    seedProblem(root, 'hashmap-counting', 'valid-anagram', {
      'README.md': '# Valid Anagram',
      'solution.ts': 'STUB',
    })
    seedAssistedDir(root, { slug: 'valid-anagram', pattern: 'hashmap-counting' })

    const names = readAssistedDir(root, 'valid-anagram')!.map((f) => f.name)

    expect(names).toEqual(['solution.ts'])
  })
})

describe('assistedCue', () => {
  it('says so rather than guessing when the directory is unreadable', () => {
    expect(assistedCue(null)).toMatch(/ask him what he has so far/)
  })

  it('distinguishes an empty directory from an unreadable one', () => {
    expect(assistedCue([])).toMatch(/has not written anything yet/)
    expect(assistedCue([{ name: 'solution.ts', source: '   \n' }])).toMatch(
      /has not written anything yet/,
    )
  })

  it('frames the code as state rather than as something he said', () => {
    const cue = assistedCue([{ name: 'solution.ts', source: 'const x = 1' }])
    expect(cue).toMatch(/For you only, not spoken/)
    expect(cue).toMatch(/do not read it aloud/)
    expect(cue).toContain('const x = 1')
    expect(cue).toContain('<file name="solution.ts">')
  })

  // Silent truncation would leave the interviewer confidently discussing half a
  // file without knowing it.
  it('announces truncation in the cue when the directory outgrows the budget', () => {
    const cue = assistedCue([{ name: 'solution.ts', source: 'x'.repeat(50_000) }])
    expect(cue).toMatch(/truncated/)
    expect(cue).toMatch(/do not treat what you have as the whole file/)
    expect(cue.length).toBeLessThan(45_000)
  })

  it('leaves an in-budget directory unannounced', () => {
    const cue = assistedCue([{ name: 'solution.ts', source: 'const x = 1' }])
    expect(cue).not.toMatch(/truncated/)
  })
})
