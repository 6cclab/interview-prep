import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { readSSE } from './test-helpers/sse'

/**
 * The coding track's HTTP surface.
 *
 * Two things separate it from the design track and both get their own tests
 * here. A coding problem's *directory* is its pattern — the answer to the drill
 * — so every route must address problems by bare slug and must never let a path
 * out; and the drill has a test suite, which means a route that runs a
 * subprocess and feeds its verdict to the interviewer without Andre having said
 * anything.
 */

let server: Server | undefined
let root: string

const PATTERN = 'two-pointers'
const SLUG = 'container-with-most-water'

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('.claude/commands/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
  seed('.claude/commands/design.md', 'DESIGN COMMAND')
  seed('system-design/rate-limiter/README.md', '# Rate limiter\n')
  seed('system-design/rate-limiter/rubric.md', '## Estimation\n')

  seed('.claude/commands/drill.md', 'DRILL COMMAND')
  seed(`problems/${PATTERN}/${SLUG}/README.md`, '# Container\n\nGiven heights, find the best pair.\n')
  seed(`problems/${PATTERN}/${SLUG}/solution.ts`, 'export {}')
  // The worked answer, seeded on purpose: a root with no spoiler in it cannot
  // demonstrate that the spoiler stays unread.
  seed(`solutions/${PATTERN}/${SLUG}.md`, 'WORKED-SOLUTION-SPOILER two pointers converging')
  seed('patterns.md', 'PATTERNS-SPOILER two-pointers -> converge from both ends')
  seed('problems/elimination/celebrity/README.md', '# Celebrity\n')
}

/** A vitest stand-in: writes the report a real run would have written. */
function reports(failed: { suite: string; title: string }[]) {
  return async (_args: string[], _cwd: string, reportPath: string) => {
    writeFileSync(
      reportPath,
      JSON.stringify({
        testResults: [
          { assertionResults: failed.map(({ suite, title }) => ({ status: 'failed', title, ancestorTitles: [suite] })) },
        ],
      }),
    )
  }
}

function baseDeps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = overrides.now ?? ((): number => 0)
  return {
    root,
    createTransport: () => async function* () {
      yield 'Tell me what the problem is asking for.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
    runDrillTests: reports([]),
    ...overrides,
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

async function startCodingSession(port: number, problem = SLUG): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: 'coding', problem }),
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-coding-'))
  seedContext()
})

afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/problems?track=coding', () => {
  it('lists coding problems by slug', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems?track=coding`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ problems: ['celebrity', SLUG] })
  })

  // The list is what populates the picker on screen. A pattern reaching it
  // would spoil every problem in that pattern before the drill even began.
  it('never lets a pattern into the list', async () => {
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/problems?track=coding`)).text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain('elimination')
    expect(body).not.toContain('problems/')
  })

  it('still defaults to the design track, as the client did before coding existed', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems`)
    expect(await res.json()).toEqual({ problems: ['rate-limiter'] })
  })

  it.each(['mock', 'nonsense', ''])('rejects track=%j', async (track) => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems?track=${track}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/problems/:problem?track=coding', () => {
  it('serves the problem statement, which he is meant to read', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/${SLUG}?track=coding`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      problem: SLUG,
      prompt: '# Container\n\nGiven heights, find the best pair.\n',
    })
  })

  // The response names the problem by the slug it was asked for. Returning
  // anything resembling where the file was found would name the pattern.
  it('does not disclose the path the README was read from', async () => {
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/problems/${SLUG}?track=coding`)).text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain('problems/')
  })

  it('404s for a slug that names no coding problem', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/no-such-drill?track=coding`)
    expect(res.status).toBe(404)
  })

  // A pattern is a real directory under `problems/`, so asking for one by name
  // must not resolve — it is not a problem, and the slug space is flat.
  it('404s for a pattern name rather than treating it as a problem', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/${PATTERN}?track=coding`)
    expect(res.status).toBe(404)
  })

  it.each(['../../patterns.md', '..%2F..%2Fpatterns.md', 'Container', 'a/b'])('refuses %j', async (problem) => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/${encodeURIComponent(problem)}?track=coding`)
    expect(res.status).not.toBe(200)
  })
})

describe('POST /api/session for the coding track', () => {
  it('creates a session carrying the problem and a budget', async () => {
    const { port } = await listen(baseDeps())
    const res = await startCodingSession(port)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'session-1',
      track: 'coding',
      problem: SLUG,
      budgetMs: 45 * 60 * 1000,
    })
  })

  // The pattern is resolved server-side to build the prompt, and must not ride
  // back out in the response that resolution happens in.
  it('never returns the pattern it resolved', async () => {
    const { port } = await listen(baseDeps())
    expect(await (await startCodingSession(port)).text()).not.toContain(PATTERN)
  })

  it('400s on a slug that names no coding problem, creating no session', async () => {
    const { port } = await listen(baseDeps())
    const res = await startCodingSession(port, 'no-such-drill')
    expect(res.status).toBe(400)
    // No session was created, so the next attempt gets 201 rather than a 409.
    expect((await startCodingSession(port)).status).toBe(201)
  })

  it('400s on a coding request with no problem at all', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coding' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/coding drill needs a problem/)
  })

  it('reopens with the drill it was started with', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1`)
    expect(await res.json()).toMatchObject({ track: 'coding', problem: SLUG, budgetMs: 45 * 60 * 1000 })
    // Same reason as the create response: a reopen must not leak it either.
    expect(JSON.stringify(await (await fetch(`http://127.0.0.1:${port}/api/session/session-1`)).json())).not.toContain(
      PATTERN,
    )
  })
})

describe('the coding interviewer prompt', () => {
  it('is given the pattern, so it can ration rung 2 of the hint ladder', async () => {
    let system = ''
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (prompt) {
          system = prompt
          yield 'Go on.'
        },
      }),
    )
    await startCodingSession(port)
    // The prompt is built at session creation and handed to the transport on
    // its first turn, so drive one.
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    expect(system).toContain(`<pattern>${PATTERN}</pattern>`)
  })

  it('is never given the worked solution or patterns.md', async () => {
    let system = ''
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (prompt) {
          system = prompt
          yield 'Go on.'
        },
      }),
    )
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    expect(system).not.toContain('WORKED-SOLUTION-SPOILER')
    expect(system).not.toContain('PATTERNS-SPOILER')
  })
})

describe('POST /api/session/:id/tests', () => {
  it('returns the verdict for a passing suite', async () => {
    const { port } = await listen(baseDeps({ runDrillTests: reports([]) }))
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'green' })
  })

  // The distinction `drill.md` is emphatic about, carried all the way to the
  // client: a right answer that costs too much is not a wrong answer.
  it('distinguishes a cost failure from a correctness failure', async () => {
    const { port } = await listen(baseDeps({ runDrillTests: reports([{ suite: 'maxArea — scale', title: 'big' }]) }))
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(await res.json()).toEqual({ kind: 'cost-red', failed: ['maxArea — scale > big'] })
  })

  it('runs the resolved problem suite, not a filter on the bare slug', async () => {
    let args: string[] = []
    const { port } = await listen(
      baseDeps({
        runDrillTests: async (a, _cwd, reportPath) => {
          args = a
          await reports([])(a, _cwd, reportPath)
        },
      }),
    )
    await startCodingSession(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(args).toContain(`problems/${PATTERN}/${SLUG}/solution.test.ts`)
  })

  // The whole point of the route: `drill.md` step 7 has the interviewer react to
  // the result, and it has no terminal of its own.
  it('makes the interviewer react out loud, over SSE', async () => {
    const fed: string[] = []
    const { port } = await listen(
      baseDeps({
        runDrillTests: reports([{ suite: 'maxArea — correctness', title: 'canonical' }]),
        createTransport: () => async function* (_system, messages) {
          fed.push(String(messages.at(-1)?.content ?? ''))
          yield 'That is failing on the canonical case.'
        },
      }),
    )
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream) // the opening turn's sentence
    await readSSE(stream) // its entry
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(await readSSE(stream)).toMatchObject({ event: 'sentence', data: { speaker: 'interviewer' } })
    // The verdict reached the interviewer as a bracketed aside, not as speech.
    expect(fed.at(-1)).toContain('[Test result, for you only:')
    expect(fed.at(-1)).toContain('correctness tests failed')
  })

  // He pressed a button. Writing an Andre entry would put words in the
  // transcript that he never said, in the record the drill is graded on.
  it('writes no Andre entry for a test run', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    await readSSE(stream) // the reaction's sentence
    await readSSE(stream) // the reaction's entry, so it is definitely committed
    const state = await (await fetch(`http://127.0.0.1:${port}/api/session/session-1`)).json()
    expect(state.entries.filter((e: { speaker: string }) => e.speaker === 'andre')).toEqual([])
    // The interviewer's reaction *was* spoken, so it is in the record.
    expect(state.entries.filter((e: { speaker: string }) => e.speaker === 'interviewer').length).toBe(2)
  })

  // The bracketed note is scaffolding Andre never heard — same rule as the
  // per-turn time check.
  it('keeps the verdict note itself out of the transcript', async () => {
    const { port } = await listen(baseDeps({ runDrillTests: reports([{ suite: 'maxArea — scale', title: 'big' }]) }))
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const written = readdirSync(join(root, 'local/drills'))
    const transcript = readFileSync(join(root, 'local/drills', written[0]!), 'utf8')
    expect(transcript).not.toContain('Test result, for you only')
  })

  // A failing suite prints the path of every file it runs, and that path is the
  // pattern. Nothing derived from a test run may carry it.
  it('never lets the pattern out through a failing test name', async () => {
    const { port } = await listen(
      baseDeps({
        runDrillTests: reports([
          { suite: `problems/${PATTERN}/${SLUG}/solution.test.ts > maxArea — scale`, title: 'big' },
        ]),
      }),
    )
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(await res.text()).not.toContain(PATTERN)
  })

  it('400s on a track that has no tests to run', async () => {
    const { port } = await listen(baseDeps())
    await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('404s for a session that does not exist', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/tests`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  // Two interviewer turns running at once would interleave their sentences into
  // each other and scramble the order of the record.
  it('refuses a test run while a turn is already in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { port } = await listen(
      baseDeps({
        runDrillTests: async (a, cwd, reportPath) => {
          await gate
          await reports([])(a, cwd, reportPath)
        },
      }),
    )
    await startCodingSession(port)
    const first = fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    // Give the first request time to register itself as in flight.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const second = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(second.status).toBe(409)
    release()
    expect((await first).status).toBe(200)
  })

  // The lock has to be released on every exit path, or the drill is left unable
  // to run tests again or to submit another answer.
  it('frees the session for another run once the reaction has finished', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    expect((await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })).status).toBe(200)
    await readSSE(stream) // the reaction's sentence
    await readSSE(stream) // its entry — the turn is now fully finished
    expect((await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })).status).toBe(200)
  })

  it('reports a runner that could not start as an errored verdict, not a red drill', async () => {
    const { port } = await listen(
      baseDeps({
        runDrillTests: async () => {
          throw new Error('spawn npx ENOENT')
        },
      }),
    )
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()).kind).toBe('errored')
  })
})

describe('the coding transcript', () => {
  it('is filed by slug under local/drills, never by pattern', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const { relPath } = await res.json()
    expect(relPath).toMatch(new RegExp(`^local/drills/${SLUG}-live-`))
    expect(relPath).not.toContain(PATTERN)
  })

  it('is not filed as a behavioural mock', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    // In `local/`, which is where transcripts actually land — asserting on the
    // repo root instead passed even with the coding branch removed entirely.
    expect(readdirSync(join(root, 'local')).filter((name) => name.startsWith('mock-'))).toEqual([])
  })
})
