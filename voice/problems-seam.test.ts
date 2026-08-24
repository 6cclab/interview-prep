import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findCodingProblem,
  installProblemSource,
  listCodingProblems,
  problemSource,
  type ProblemSource,
  resetProblemSource,
  resolveMode,
  stripPatternPaths,
} from './problems'
import { fsProblems } from './problems-fs'

/**
 * The seam that lets a deployed instance serve problems from Postgres while a
 * local run keeps walking `problems/` on disk.
 *
 * Nothing here tests *which* problems come back — `coding-routes.test.ts` and
 * the spoiler gate already do that, and this split deliberately did not change
 * it. What is pinned here is the selection: that it defaults to local, that a
 * typo in `VOICE_MODE` is loud, and that the unbuilt half fails rather than
 * quietly answering with the wrong store.
 */

const roots: string[] = []

function repoWith(pattern: string, slug: string): string {
  const root = mkdtempSync(join(tmpdir(), 'voice-seam-'))
  roots.push(root)
  const dir = join(root, 'problems', pattern, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), `# ${slug}\n`)
  writeFileSync(join(dir, 'meta.yaml'), 'difficulty: warmup\n')
  return root
}

afterEach(() => {
  resetProblemSource()
  delete process.env.VOICE_MODE
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveMode', () => {
  /**
   * The local drill is the daily loop and has to work with no setup at all — no
   * database, no auth, no environment. Requiring the variable would mean a fresh
   * clone could not run a drill until it was told which of two worlds it was in.
   */
  it('defaults to local when nothing is set', () => {
    expect(resolveMode({})).toBe('local')
    expect(resolveMode({ VOICE_MODE: '' })).toBe('local')
  })

  it('takes the two modes it knows', () => {
    expect(resolveMode({ VOICE_MODE: 'local' })).toBe('local')
    expect(resolveMode({ VOICE_MODE: 'deployed' })).toBe('deployed')
  })

  /**
   * The important one. A silent fall back to local would mean
   * `VOICE_MODE=production` on a real deployment serving whatever `problems/`
   * tree happened to be baked into the image, with per-user data going nowhere
   * and nothing saying so. It has to be a throw that names the value.
   */
  it.each(['production', 'prod', 'Local', 'deployed ', 'db'])('refuses %j rather than guessing', (mode) => {
    expect(() => resolveMode({ VOICE_MODE: mode })).toThrow(/VOICE_MODE must be one of/)
  })

  it('names the offending value, so the fix is in the message', () => {
    expect(() => resolveMode({ VOICE_MODE: 'production' })).toThrow(/"production"/)
  })
})

describe('problemSource', () => {
  it('is the filesystem source by default', () => {
    expect(problemSource()).toBe(fsProblems)
  })

  it('is the filesystem source when local is asked for explicitly', () => {
    process.env.VOICE_MODE = 'local'
    resetProblemSource()
    expect(problemSource()).toBe(fsProblems)
  })

  /**
   * `deployed` mode serves from Postgres, and `main()` installs that source at
   * startup. Until something does, the stub throws rather than falling through
   * to the disk — an absent case that quietly read `problems/` would make a
   * deployment whose startup half-failed look like it worked.
   */
  it('fails loudly in deployed mode instead of reading the disk', () => {
    const root = repoWith('sliding-window', 'longest-substring')
    process.env.VOICE_MODE = 'deployed'
    resetProblemSource()
    expect(() => listCodingProblems(root)).toThrow(/startup has not installed/)
    expect(() => findCodingProblem(root, 'longest-substring')).toThrow(/startup has not installed/)
  })

  /**
   * The Postgres source is injected rather than imported, so that `pg` and the
   * whole `voice/db` tree stay off the local path — every coding drill in the
   * repo imports this module transitively. What is pinned here is that the
   * injection actually takes effect, because the alternative failure is a
   * deployed server silently serving the stub's throw forever.
   */
  it('serves whatever startup installs', () => {
    const root = repoWith('sliding-window', 'longest-substring')
    process.env.VOICE_MODE = 'deployed'
    resetProblemSource()
    const fake: ProblemSource = {
      list: () => [{ slug: 'from-the-database', pattern: 'two-pointers', difficulty: 'medium' }],
      find: () => null,
    }
    installProblemSource(fake)
    expect(listCodingProblems(root).map((p) => p.slug)).toEqual(['from-the-database'])
    expect(findCodingProblem(root, 'longest-substring')).toBeNull()
  })

  /**
   * Chosen once, not per call. A process that re-read the environment on every
   * request could change store halfway through a drill.
   */
  it('does not change under a running process', () => {
    const first = problemSource()
    process.env.VOICE_MODE = 'deployed'
    expect(problemSource()).toBe(first)
  })
})

describe('the filesystem source, through the seam', () => {
  /**
   * The split moved code; it did not change what the code does. Both entry
   * points still answer out of a real directory tree, and `root` still points
   * wherever a test says — which is why it stayed in the signature even though
   * a database has no use for one.
   */
  it('still reads a real tree, and still honours root', () => {
    const root = repoWith('two-pointers', 'valid-palindrome')
    expect(listCodingProblems(root)).toEqual([
      { slug: 'valid-palindrome', pattern: 'two-pointers', difficulty: 'warmup' },
    ])
    expect(findCodingProblem(root, 'valid-palindrome')?.pattern).toBe('two-pointers')
    expect(findCodingProblem(root, 'no-such-problem')).toBeNull()
  })

  /**
   * `stripPatternPaths` survives the split and stays load-bearing. Local mode
   * still spawns vitest against a real path, and vitest prints that path — which
   * contains the pattern, which is the answer. It is only unreachable on the
   * deployed path, where no filename ever enters the picture.
   */
  it('keeps the pattern out of text that has been through vitest', () => {
    const stripped = stripPatternPaths('FAIL problems/two-pointers/valid-palindrome/solution.test.ts')
    expect(stripped).not.toContain('two-pointers')
    expect(stripped).toBe('FAIL problems/valid-palindrome/solution.test.ts')
  })
})
