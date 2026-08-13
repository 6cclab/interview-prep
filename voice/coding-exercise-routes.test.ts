import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * `GET /api/coding/<slug>/exercise` — the one route that hands a browser
 * everything it needs to run a coding drill's suite itself.
 *
 * Kept out of `coding-routes.test.ts`: that file already runs long, and this
 * route's defining property — it must serve `stub.ts` and never so much as
 * open `solution.ts` — is worth a fixture built to prove exactly that, rather
 * than reusing fixtures shaped for the transcript and interviewer tests.
 */

let server: Server | undefined
let root: string

const PATTERN = 'two-pointers'
const SLUG = 'container-with-most-water'
const OTHER_PATTERN = 'elimination'
const OTHER_SLUG = 'celebrity'

function seed(relPath: string, body: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

function seedTestUtils() {
  // Only the shape these tests need: something recognisable and something a
  // response could plausibly be checked against. The real modules are proven
  // free of `node:` imports separately; these fixtures do not need to be real
  // implementations to prove the route selects and serves the right ones.
  seed('test-utils/random.ts', 'export function mulberry32() { return 0 }')
  seed('test-utils/oracle.ts', 'export function assertWithinBudget() {}')
  seed('test-utils/sequence.ts', 'export function firstDifference() {}')
}

function seedProblem(
  pattern: string,
  slug: string,
  opts: { stub: string; test: string; solution?: string },
) {
  seed(`problems/${pattern}/${slug}/README.md`, `# ${slug}\n`)
  seed(`problems/${pattern}/${slug}/meta.yaml`, `pattern: ${pattern}\ndifficulty: medium\n`)
  seed(`problems/${pattern}/${slug}/stub.ts`, opts.stub)
  seed(`problems/${pattern}/${slug}/solution.test.ts`, opts.test)
  // A worked answer is seeded on purpose, same reasoning as
  // `coding-routes.test.ts`: a root with no spoiler in it cannot demonstrate
  // that the spoiler stays unread.
  seed(`problems/${pattern}/${slug}/solution.ts`, opts.solution ?? 'export {}')
}

function baseDeps(): VoiceServerDeps {
  const now = (): number => 0
  return {
    root,
    createTransport: () => async function* () {
      yield 'Go on.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
    runDrillTests: async () => {
      throw new Error('not used in these tests')
    },
  }
}

function listen(deps: VoiceServerDeps): Promise<{ port: number }> {
  server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-exercise-'))
  seedTestUtils()
})

afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/coding/:slug/exercise', () => {
  it('serves the stub, the suite, and the test-utils it imports', async () => {
    seedProblem(PATTERN, SLUG, {
      stub: 'export function maxArea(heights: number[]): number {\n  throw new Error("not implemented")\n}\n',
      test: [
        "import { describe, expect, it } from 'vitest'",
        "import { mulberry32 } from '../../../test-utils/random'",
        "describe('maxArea — correctness', () => {})",
      ].join('\n'),
    })
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${SLUG}/exercise`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stub: string; test: string; utils: Record<string, string> }
    expect(body.stub).toContain('function maxArea')
    expect(body.test).toContain("maxArea — correctness")
    expect(Object.keys(body.utils)).toEqual(['../../../test-utils/random'])
    expect(body.utils['../../../test-utils/random']).toContain('mulberry32')
  })

  // The one property this whole route exists to hold. A fixture whose
  // `solution.ts` carries a recognisable answer string, asserted absent from
  // anywhere in the response body — not merely absent from the `stub` field,
  // in case a future change accidentally folds solution text into `test` or
  // `utils` instead.
  it('never reads solution.ts, even though one sits right beside the stub', async () => {
    seedProblem(PATTERN, SLUG, {
      stub: 'export function maxArea(heights: number[]): number {\n  throw new Error("not implemented")\n}\n',
      test: "import { mulberry32 } from '../../../test-utils/random'\ndescribe('x', () => {})",
      solution: 'export function maxArea(heights: number[]): number {\n  return WORKED_ANSWER_SPOILER_4217\n}\n',
    })
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${SLUG}/exercise`)
    const raw = await res.text()
    expect(raw).not.toContain('WORKED_ANSWER_SPOILER_4217')
  })

  // The pattern is the answer to the drill, and this route's directory lookup
  // goes through it just like every other coding route. Same rule as
  // `coding-routes.test.ts`'s `/api/problems/:problem` and `/api/session`
  // assertions.
  it('never discloses the pattern directory it resolved through', async () => {
    seedProblem(PATTERN, SLUG, {
      stub: 'export function maxArea() {}\n',
      test: "describe('x', () => {})",
    })
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${SLUG}/exercise`)
    const raw = await res.text()
    expect(raw).not.toContain(PATTERN)
    expect(raw).not.toContain('problems/')
  })

  it('404s for a slug that names no coding problem', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/no-such-drill/exercise`)
    expect(res.status).toBe(404)
  })

  // A traversal segment cannot survive `PROBLEM_SLUG`, and even if it somehow
  // reached `findCodingProblem` that function only ever returns a directory it
  // found by scanning `problems/`, never one built from the input — so there
  // is no path by which this route reads outside `problems/`.
  it.each(['..%2F..%2Fpatterns.md', '..%2Fetc%2Fpasswd', 'a%2Fb'])('refuses traversal slug %j', async (slug) => {
    seedProblem(PATTERN, SLUG, { stub: 'export {}\n', test: "describe('x', () => {})" })
    // Seed something a successful traversal could have read, so a false pass
    // would be a body full of it rather than a coincidental empty match.
    seed('patterns.md', 'PATTERNS-SPOILER should never be reachable from here')
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${slug}/exercise`)
    expect(res.status).not.toBe(200)
    expect(await res.text()).not.toContain('PATTERNS-SPOILER')
  })

  // Only the modules the suite actually imports travel — 19 of the real
  // problems import `random`, 4 `oracle`, 3 `sequence`, and it varies per
  // problem, so shipping all three regardless would be silently wrong for
  // most of them.
  it('sends only the test-utils modules this particular suite imports', async () => {
    seedProblem(OTHER_PATTERN, OTHER_SLUG, {
      stub: 'export function isCelebrity() {}\n',
      test: [
        "import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'",
        "import { seededTrials } from '../../../test-utils/random'",
        "describe('isCelebrity — correctness', () => {})",
      ].join('\n'),
    })
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${OTHER_SLUG}/exercise`)
    const body = (await res.json()) as { utils: Record<string, string> }
    expect(Object.keys(body.utils).sort()).toEqual(
      ['../../../test-utils/oracle', '../../../test-utils/random'].sort(),
    )
    expect(body.utils['../../../test-utils/sequence']).toBeUndefined()
  })

  it('imports nothing when the suite imports no test-utils module', async () => {
    seedProblem(PATTERN, SLUG, {
      stub: 'export function maxArea() {}\n',
      test: "import { describe } from 'vitest'\ndescribe('x', () => {})",
    })
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${SLUG}/exercise`)
    const body = (await res.json()) as { utils: Record<string, string> }
    expect(body.utils).toEqual({})
  })
})
