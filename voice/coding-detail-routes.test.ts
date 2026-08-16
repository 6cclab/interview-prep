import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * The browsing surface a NeetCode-style client needs beyond a live drill:
 * a richer problem list, aggregate progress, a study roadmap, the worked
 * answer for something already attempted, and "what's rusty" by itself.
 *
 * All five share one constraint that gets its own test in every describe
 * block below: the pattern — the answer to the drill — must reach the wire
 * only where the task spec explicitly allows it (`/api/roadmap?study=1`,
 * scoped to attempted problems only) and never anywhere else. Same rule
 * `voice/coding-routes.test.ts` already enforces for the live-drill routes.
 */

let server: Server | undefined
let root: string

const PATTERN = 'two-pointers'
const SLUG = 'container-with-most-water'
const OTHER_PATTERN = 'elimination'
const OTHER_SLUG = 'celebrity'

function seed() {
  const w = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  w('prompts/mock.md', 'MOCK COMMAND')
  w('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  w('behavioral/questions.md', 'QUESTIONS')

  w(`problems/${PATTERN}/${SLUG}/README.md`, '# Container\n\nGiven heights, find the best pair.\n')
  w(`problems/${PATTERN}/${SLUG}/solution.ts`, 'export function maxArea() {}\n')
  w(`problems/${PATTERN}/${SLUG}/solution.test.ts`, "describe('x', () => {})")
  w(
    `problems/${PATTERN}/${SLUG}/meta.yaml`,
    [
      `pattern: ${PATTERN}`,
      'title: Container With Most Water',
      'difficulty: medium',
      'companies:',
      '  - name: amazon',
      '    confidence: high',
      '    source: reported',
      '    date: "2026-01-01"',
    ].join('\n'),
  )
  w(`solutions/${PATTERN}/${SLUG}.md`, 'WORKED-SOLUTION-SPOILER two pointers converging')

  w(`problems/${OTHER_PATTERN}/${OTHER_SLUG}/README.md`, '# Celebrity\n')
  w(`problems/${OTHER_PATTERN}/${OTHER_SLUG}/solution.ts`, 'export function celebrity() {}\n')
  w(
    `problems/${OTHER_PATTERN}/${OTHER_SLUG}/meta.yaml`,
    `pattern: ${OTHER_PATTERN}\ntitle: Find the Celebrity\ndifficulty: hard\ncompanies: []\n`,
  )
  w(`solutions/${OTHER_PATTERN}/${OTHER_SLUG}.md`, 'WORKED-SOLUTION-SPOILER elimination candidate pass')

  w('patterns.md', 'PATTERNS-SPOILER two-pointers -> converge from both ends')
}

function seedLog(root_: string, relDir: string, ...rows: string[]) {
  mkdirSync(join(root_, relDir), { recursive: true })
  writeFileSync(
    join(root_, relDir, 'drill-log.md'),
    ['# Drill Log', '', '| Date | Problem | Pattern | Solved | Hints | Time | Note |', '|---|---|---|---|---|---|---|', ...rows, ''].join(
      '\n',
    ),
  )
}

function deps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  return {
    root,
    createTransport: () => async function* () {},
    transcriber: { transcribe: async () => ({ text: '' }) },
    ...overrides,
  }
}

function listen(d: VoiceServerDeps): Promise<{ port: number }> {
  server = createVoiceServer(d)
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-coding-detail-'))
  seed()
})

afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/problems/coding/detail', () => {
  it('returns slug, title, difficulty and companies for every problem', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/coding/detail`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { problems: { slug: string; title: string; difficulty: string; companies: unknown[] }[] }
    const container = body.problems.find((p) => p.slug === SLUG)
    expect(container).toEqual({
      slug: SLUG,
      title: 'Container With Most Water',
      difficulty: 'medium',
      companies: [{ name: 'amazon', confidence: 'high' }],
    })
    const celebrity = body.problems.find((p) => p.slug === OTHER_SLUG)
    expect(celebrity).toEqual({ slug: OTHER_SLUG, title: 'Find the Celebrity', difficulty: 'hard', companies: [] })
  })

  // The load-bearing test: never a pattern directory name anywhere on the wire.
  it('never includes a pattern in any response field', async () => {
    const { port } = await listen(deps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/problems/coding/detail`)).text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain(OTHER_PATTERN)
    expect(body).not.toContain('problems/')
  })
})

describe('GET /api/progress', () => {
  it('reuses drill-log summarise() verbatim for `summary`', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Clean. |`)
    const { port } = await listen(deps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/progress`)).json()) as {
      summary: { attempts: number; solved: number; cold: number; problems: number }
    }
    expect(body.summary).toMatchObject({ attempts: 1, solved: 1, cold: 1, problems: 1 })
  })

  it('reports byDifficulty with cold and helped kept separate', async () => {
    seedLog(
      root,
      'local',
      `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Clean. |`,
      `| 2026-08-02 | ${OTHER_SLUG} | ${OTHER_PATTERN} | yes | 3 | 30:00 | Needed help. |`,
    )
    const { port } = await listen(deps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/progress`)).json()) as {
      byDifficulty: { difficulty: string; cold: number; helped: number; unsolved: number; unattempted: number; total: number }[]
    }
    const medium = body.byDifficulty.find((d) => d.difficulty === 'medium')!
    expect(medium).toMatchObject({ cold: 1, helped: 0, total: 1 })
    const hard = body.byDifficulty.find((d) => d.difficulty === 'hard')!
    expect(hard).toMatchObject({ cold: 0, helped: 1, total: 1 })
  })

  it('never mentions a pattern anywhere in the response', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Clean. |`)
    const { port } = await listen(deps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/progress`)).text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain(OTHER_PATTERN)
  })

  it("reads the requesting user's own drill log in deployed mode, not local's", async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Local, not alice's. |`)
    seedLog(root, 'local/users/ak-alice', `| 2026-08-02 | ${OTHER_SLUG} | ${OTHER_PATTERN} | yes | 0 | 05:00 | Alice's own. |`)
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/progress`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    const body = (await res.json()) as { summary: { attempts: number; cold: number } }
    expect(body.summary.attempts).toBe(1)
    expect(body.summary.cold).toBe(1)
  })
})

describe('GET /api/roadmap', () => {
  it('400s without ?study=1', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/roadmap`)
    expect(res.status).toBe(400)
  })

  it.each(['0', 'yes', 'true', ''])('400s for study=%j', async (value) => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/roadmap?study=${value}`)
    expect(res.status).toBe(400)
  })

  it('groups an attempted problem under the pattern its drill-log row names', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Clean. |`)
    const { port } = await listen(deps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/roadmap?study=1`)).json()) as {
      patterns: { pattern: string | null; problems: { slug: string; attempted: boolean; cold: boolean }[] }[]
    }
    const group = body.patterns.find((g) => g.pattern === PATTERN)
    expect(group?.problems).toEqual([{ slug: SLUG, title: 'Container With Most Water', attempted: true, cold: true }])
  })

  // The stricter half of the gate, and the task calls out testing it
  // explicitly: an unattempted problem must stay anonymous even though the
  // repo full well knows its real pattern.
  it('keeps an unattempted problem out of any named pattern group', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Clean. |`)
    const { port } = await listen(deps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/roadmap?study=1`)).json()) as {
      patterns: { pattern: string | null; problems: { slug: string }[] }[]
    }
    const anonymous = body.patterns.find((g) => g.pattern === null)
    expect(anonymous?.problems.map((p) => p.slug)).toEqual([OTHER_SLUG])
    expect(body.patterns.every((g) => g.problems.every((p) => p.slug !== OTHER_SLUG || g.pattern === null))).toBe(true)
  })

  it('lists every problem as anonymous when nothing has been attempted at all', async () => {
    const { port } = await listen(deps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/roadmap?study=1`)).json()) as {
      patterns: { pattern: string | null; problems: { slug: string }[] }[]
    }
    expect(body.patterns).toHaveLength(1)
    expect(body.patterns[0]!.pattern).toBeNull()
    expect(body.patterns[0]!.problems.map((p) => p.slug).sort()).toEqual([OTHER_SLUG, SLUG].sort())
  })

  it("reads the requesting user's own drill log in deployed mode", async () => {
    seedLog(root, 'local/users/ak-alice', `| 2026-08-02 | ${SLUG} | ${PATTERN} | yes | 0 | 05:00 | Alice's own. |`)
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/roadmap?study=1`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    const body = (await res.json()) as { patterns: { pattern: string | null }[] }
    expect(body.patterns.some((g) => g.pattern === PATTERN)).toBe(true)
  })
})

describe('GET /api/review/:slug', () => {
  it('403s when there is no logged attempt', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/review/${SLUG}`)
    expect(res.status).toBe(403)
  })

  it('404s for a slug that names no coding problem', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/review/no-such-drill`)
    expect(res.status).toBe(404)
  })

  it('returns the answer, readme, attempt and row once a row exists', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 1 | 04:12 | Found it eventually. |`)
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/review/${SLUG}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      answer: string
      readme: string
      attempt: string
      row: { problem: string; solved: boolean; hints: number }
    }
    expect(body.answer).toContain('WORKED-SOLUTION-SPOILER')
    expect(body.readme).toContain('best pair')
    expect(body.attempt).toContain('maxArea')
    expect(body.row).toMatchObject({ problem: SLUG, solved: true, hints: 1 })
  })

  // No `?anyway=1` bypass — a URL is bookmarkable in a way a conversation is
  // not, and the task is explicit that there must be no such escape hatch.
  it('has no query-string bypass for a missing row', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/review/${SLUG}?anyway=1`)
    expect(res.status).toBe(403)
  })

  it('403s a user with no row of their own even when local/ has one', async () => {
    seedLog(root, 'local', `| 2026-08-01 | ${SLUG} | ${PATTERN} | yes | 0 | 04:12 | Local only. |`)
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/review/${SLUG}`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    expect(res.status).toBe(403)
  })

  it("succeeds once the requesting user's own log has the row", async () => {
    seedLog(root, 'local/users/ak-alice', `| 2026-08-02 | ${SLUG} | ${PATTERN} | yes | 0 | 05:00 | Alice's own. |`)
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/review/${SLUG}`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/rust', () => {
  it('picks a never-attempted problem first', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/rust`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { slug: string; why: string }
    expect([SLUG, OTHER_SLUG]).toContain(body.slug)
    expect(body.why).toBe('never attempted')
  })

  it('never mentions a pattern in its response', async () => {
    const { port } = await listen(deps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/rust`)).text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain(OTHER_PATTERN)
  })

  it("reads the requesting user's own drill log in deployed mode", async () => {
    seedLog(root, 'local/users/ak-alice', `| 2026-08-02 | ${SLUG} | ${PATTERN} | yes | 0 | 05:00 | Alice's own. |`)
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/rust`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    const body = (await res.json()) as { slug: string; why: string }
    // Alice has solved SLUG cold, so the never-attempted pick should be the other one.
    expect(body.slug).toBe(OTHER_SLUG)
    expect(body.why).toBe('never attempted')
  })
})
