import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { appendCoached } from './coached'
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
  // The suite: excluded from a drill's allowlist on purpose, but required by
  // `coachPaths` — half of pairing on a red suite is reading the failing test.
  seed(`problems/${PATTERN}/${SLUG}/solution.test.ts`, "describe('x — correctness', () => {})")
  // The worked answer, seeded on purpose: a root with no spoiler in it cannot
  // demonstrate that the spoiler stays unread.
  seed(`solutions/${PATTERN}/${SLUG}.md`, 'WORKED-SOLUTION-SPOILER two pointers converging')
  seed('patterns.md', 'PATTERNS-SPOILER two-pointers -> converge from both ends')
  seed('problems/elimination/celebrity/README.md', '# Celebrity\n')
  seed(`problems/${PATTERN}/${SLUG}/meta.yaml`, `pattern: ${PATTERN}\ndifficulty: medium\n`)
  seed('problems/elimination/celebrity/meta.yaml', 'pattern: elimination\ndifficulty: hard\n')
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
    expect(await res.json()).toEqual({
      problems: ['celebrity', SLUG],
      difficulties: { celebrity: 'hard', [SLUG]: 'medium' },
    })
  })

  // The tier is what makes opening with a warm-up findable rather than a guess.
  // A problem whose meta.yaml says nothing must still be listed and pickable.
  it('reports a tier for every problem, unrated when meta.yaml does not say', async () => {
    const bare = join(root, 'problems/trie/word-dictionary')
    mkdirSync(bare, { recursive: true })
    writeFileSync(join(bare, 'README.md'), '# Word dictionary\n')

    const { port } = await listen(baseDeps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/problems?track=coding`)).json()) as {
      problems: string[]
      difficulties: Record<string, string>
    }
    expect(body.problems).toContain('word-dictionary')
    expect(body.difficulties['word-dictionary']).toBe('unrated')
    // Every listed problem carries a tier, so the client never has to guess.
    expect(Object.keys(body.difficulties).sort()).toEqual([...body.problems].sort())
  })

  // The design track has no difficulty field, and its payload must not grow one
  // — a client keying off `difficulties` being absent is how it stays a flat list.
  it('sends no difficulties for the design track', async () => {
    const { port } = await listen(baseDeps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/problems?track=design`)).json()) as object
    expect(Object.keys(body)).toEqual(['problems'])
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

  // `mock` used to belong in this list. It is a real track here now — the
  // behavioural card offers a competency picker rather than one button — so the
  // list is unknown tracks only, which is what the check was ever about.
  it.each(['nonsense', ''])('rejects track=%j', async (track) => {
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
    expect(((await res.json()) as { error: string }).error).toMatch(/coding drill needs a problem/)
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
    const state = (await (await fetch(`http://127.0.0.1:${port}/api/session/session-1`)).json()) as {
      entries: { speaker: string }[]
    }
    expect(state.entries.filter((e) => e.speaker === 'andre')).toEqual([])
    // The interviewer's reaction *was* spoken, so it is in the record.
    expect(state.entries.filter((e) => e.speaker === 'interviewer').length).toBe(2)
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
    expect(((await res.json()) as { kind: string }).kind).toBe('errored')
  })
})

describe('POST /api/session/:id/hint', () => {
  /** Records what the interviewer was fed, so the cue can be asserted on. */
  function capturing(fed: string[]): Partial<VoiceServerDeps> {
    return {
      createTransport: () => async function* (_system, messages) {
        fed.push(String(messages.at(-1)?.content ?? ''))
        yield 'Think about what you can rule out.'
      },
    }
  }

  it('advances exactly one rung per request, and reports the rung', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    for (const expected of [1, 2, 3, 4]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
      expect(res.status).toBe(200)
      // `servable` is always true on this track: every coding rung can be given.
      // It exists for the debugging ladder, which runs out at rung 1.
      expect(await res.json()).toEqual({ rung: expected, servable: true })
    }
  })

  // Rung 4 is the full worked solution: there is nothing further to give. Asking
  // again is not an error, though — a 409 would leave the button looking broken at
  // the moment he is most stuck.
  it('clamps at the last rung rather than refusing', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
      expect(res.status).toBe(200)
    }
    const state = (await (await fetch(`http://127.0.0.1:${port}/api/session/session-1`)).json()) as {
      hintRung: number
    }
    expect(state.hintRung).toBe(4)
  })

  // The ladder's whole value is that it is rationed. A model asked for "a hint"
  // over-delivers, so the cue names one rung and quotes it verbatim.
  it('tells the interviewer which single rung is owed, and to stop there', async () => {
    const fed: string[] = []
    const { port } = await listen(baseDeps(capturing(fed)))
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await readSSE(stream)
    expect(fed.at(-1)).toContain('[Hint request, for you only: give rung 1')
    expect(fed.at(-1)).toContain('does not name the pattern')
    expect(fed.at(-1)).toMatch(/not the one above it/)
  })

  // Rung 2 IS the pattern name, so it is the one rung whose cue must contain it.
  it('names the pattern only at rung 2', async () => {
    const fed: string[] = []
    const { port } = await listen(baseDeps(capturing(fed)))
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await readSSE(stream)
    await readSSE(stream)
    expect(fed.at(-1)).not.toContain('pattern name')
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await readSSE(stream)
    expect(fed.at(-1)).toContain('the pattern name, and nothing else')
  })

  it('makes the interviewer deliver it out loud', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    expect(await readSSE(stream)).toMatchObject({ event: 'sentence', data: { speaker: 'interviewer' } })
  })

  // He pressed a button; he said nothing. Same rule as a test run.
  it('writes no Andre entry, and keeps the cue out of the transcript', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream)
    await readSSE(stream)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await readSSE(stream)
    await readSSE(stream)
    const state = (await (await fetch(`http://127.0.0.1:${port}/api/session/session-1`)).json()) as {
      entries: { speaker: string; text: string }[]
    }
    expect(state.entries.filter((e) => e.speaker === 'andre')).toEqual([])
    expect(JSON.stringify(state.entries)).not.toContain('Hint request')
  })

  it.each(['mock', 'design'] as const)('400s on the %s track, which has no ladder', async (track) => {
    const { port } = await listen(baseDeps())
    await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(track === 'mock' ? { track } : { track, problem: 'rate-limiter' }),
    })
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('404s for a session that does not exist', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/hint`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('the drill log a spoken coding drill writes', () => {
  /** An interviewer that closes with the drill-log trailer, as its prompt tells it to. */
  function closing(trailer: string): Partial<VoiceServerDeps> {
    return {
      createTransport: () => async function* () {
        yield `That is the one. ${trailer}`
      },
    }
  }

  const TRAILER = '```drill-log\nsolved: yes\nnote: found the elimination pass, forgot to verify\n```'

  function logBody(): string {
    return readFileSync(join(root, 'local/drill-log.md'), 'utf8')
  }

  /**
   * Drive the opening turn to completion.
   *
   * The trailer is read off `interviewer.lastRaw()`, which only exists once the
   * interviewer has actually spoken — and the opening turn does not run until a
   * client connects to the stream. Ending a session that never had one leaves
   * nothing to parse, which is correct behaviour and not what these tests are for.
   */
  async function begin(port: number): Promise<Response> {
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await readSSE(stream) // the opening sentence
    await readSSE(stream) // its entry, so the reply is complete
    return stream
  }

  // The gap this closes: /status reads exactly one log to find rusty patterns, and
  // a spoken drill used to append nothing at all to it.
  it('appends a row in the same table /drill writes', async () => {
    const { port } = await listen(baseDeps(closing(TRAILER)))
    await startCodingSession(port)
    await begin(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(await res.json()).toMatchObject({ drillLogWritten: true })
    expect(logBody()).toContain('| Date | Problem | Pattern | Solved | Hints | Time | Note |')
    expect(logBody()).toContain(`| ${SLUG} | ${PATTERN} | yes | 0 | 00:00 | found the elimination pass, forgot to verify |`)
  })

  // The hint count is the server's, not the interviewer's — it is the number
  // /status uses to tell rust from coverage, so it is a measurement.
  it('records the rungs actually taken, not a number the interviewer recalled', async () => {
    const { port } = await listen(
      baseDeps(closing('```drill-log\nsolved: yes\nnote: needed no help at all\n```')),
    )
    await startCodingSession(port)
    await begin(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/hint`, { method: 'POST' })
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(logBody()).toContain('| yes | 2 | 00:00 |')
  })

  it('reads solved: no as unsolved', async () => {
    const { port } = await listen(baseDeps(closing('```drill-log\nsolved: no\nnote: never found the invariant\n```')))
    await startCodingSession(port)
    await begin(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(logBody()).toContain('| no | 0 |')
  })

  // A solve wrongly logged as a miss re-queues a pattern; a miss wrongly logged as
  // a solve removes it from the queue and rots the signal. So anything that is not
  // an explicit yes is a no.
  it.each(['maybe', 'partially', 'true', ''])('treats solved: %j as unsolved', async (value) => {
    const { port } = await listen(baseDeps(closing(`\`\`\`drill-log\nsolved: ${value}\nnote: n\n\`\`\``)))
    await startCodingSession(port)
    await begin(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(logBody()).toContain('| no | 0 |')
  })

  it('never speaks the trailer', async () => {
    const { port } = await listen(baseDeps(closing(TRAILER)))
    await startCodingSession(port)
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    const sentence = await readSSE(stream)
    expect(JSON.stringify(sentence)).not.toContain('drill-log')
    expect(JSON.stringify(sentence)).not.toContain('solved:')
  })

  // The transcript is still the product of the drill. Losing a log row costs one
  // data point in /status; refusing to save the recording would lose the session.
  it('still saves the transcript when the interviewer emits no trailer', async () => {
    const { port } = await listen(baseDeps(closing('no trailer here')))
    await startCodingSession(port)
    await begin(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const body = (await res.json()) as { relPath: string; drillLogWritten: boolean }
    expect(body.drillLogWritten).toBe(false)
    expect(existsSync(join(root, body.relPath))).toBe(true)
  })

  // The gap this closes: the trailer is instructed for the interviewer's *final*
  // turn, and <voice-mode> frames that as time running out. Most drills end with
  // the button instead, so before this the log row existed only for the drills
  // that ran the full forty-five minutes.
  it('drives a closing turn on end, so a drill ended early still logs', async () => {
    const fed: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system, messages) {
          fed.push(String(messages.at(-1)?.content ?? ''))
          yield `Good enough. ${TRAILER}`
        },
      }),
    )
    await startCodingSession(port)
    await begin(port)
    const before = fed.length
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(await res.json()).toMatchObject({ drillLogWritten: true })
    // One more interviewer turn than had run before the request.
    expect(fed.length).toBe(before + 1)
    expect(fed.at(-1)).toContain('this is your final turn')
  })

  it('records the closing verdict in the transcript, and not its cue', async () => {
    const { port } = await listen(baseDeps(closing(TRAILER)))
    await startCodingSession(port)
    await begin(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const { relPath } = (await res.json()) as { relPath: string }
    const transcript = readFileSync(join(root, relPath), 'utf8')
    expect(transcript).toContain('That is the one.')
    expect(transcript).not.toContain('final turn')
    expect(transcript).not.toContain('drill-log')
  })

  // "End session" must always end the session. Blocking on another turn, or racing
  // it, is worse than losing one log row.
  it('still ends, without a closing turn, when a turn is already in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { port } = await listen(
      baseDeps({
        ...closing(TRAILER),
        runDrillTests: async (a, cwd, reportPath) => {
          await gate
          await reports([])(a, cwd, reportPath)
        },
      }),
    )
    await startCodingSession(port)
    await begin(port)
    const running = fetch(`http://127.0.0.1:${port}/api/session/session-1/tests`, { method: 'POST' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(res.status).toBe(200)
    release()
    await running
  })

  it('does not drive a closing turn on the other tracks', async () => {
    const fed: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system, messages) {
          fed.push(String(messages.at(-1)?.content ?? ''))
          yield 'Tell me about a disagreement.'
        },
      }),
    )
    await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    await begin(port)
    const before = fed.length
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(fed.length).toBe(before)
  })

  it('does not write a drill-log row for the other tracks', async () => {
    const { port } = await listen(baseDeps(closing(TRAILER)))
    await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    await begin(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    expect(await res.json()).toMatchObject({ drillLogWritten: false })
    expect(existsSync(join(root, 'local/drill-log.md'))).toBe(false)
  })

  // A pipe in the note would split the row into extra columns and corrupt the
  // table for every reader after it.
  it('escapes a pipe in the note rather than breaking the table', async () => {
    const { port } = await listen(
      baseDeps(closing('```drill-log\nsolved: yes\nnote: used a | b instead of a || b\n```')),
    )
    await startCodingSession(port)
    await begin(port)
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const row = logBody().split('\n').find((line) => line.includes('instead of'))!
    expect(row).toContain('a \\| b')
    // Seven columns, so the row still parses as one row.
    expect(row.split(/(?<!\\)\|/)).toHaveLength(9)
  })
})

describe('the coding transcript', () => {
  it('is filed by slug under local/drills, never by pattern', async () => {
    const { port } = await listen(baseDeps())
    await startCodingSession(port)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/session-1/end`, { method: 'POST' })
    const { relPath } = (await res.json()) as { relPath: string }
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

/**
 * The history screen's data. `local/drill-log.md` is the only structured record
 * any track keeps, and until now nothing read it back at all.
 */
describe('GET /api/history', () => {
  const ROW = '| 2026-08-09 | container-with-most-water | two-pointers | yes | 1 | 04:12 | Shipped early. |'

  function seedLog(...rows: string[]) {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(
      join(root, 'local/drill-log.md'),
      [
        '# Drill Log',
        '',
        '| Date | Problem | Pattern | Solved | Hints | Time | Note |',
        '|------|---------|---------|--------|-------|------|------|',
        ...rows,
        '',
      ].join('\n'),
    )
  }

  it('reports past drills newest first, with a summary', async () => {
    seedLog('| 2026-08-01 | celebrity | elimination | no | 4 | 45:00 | Ran out. |', ROW)
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/history`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      summary: { attempts: number; solved: number; cold: number }
      rows: { problem: string }[]
    }
    expect(body.rows.map((row) => row.problem)).toEqual(['container-with-most-water', 'celebrity'])
    expect(body.summary).toMatchObject({ attempts: 2, solved: 1, cold: 0 })
  })

  // The history screen is read *between* drills, and /review re-queues problems
  // for spaced repetition. A permanent problem-to-pattern list on screen would
  // spoil every re-drill, so the pattern stays off the wire unless asked for —
  // structurally, not by the client remembering to hide it.
  it('withholds the pattern by default', async () => {
    seedLog(ROW)
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/history`)).text()
    expect(body).not.toContain('two-pointers')
    expect(body).not.toContain(PATTERN)
    expect(body).toContain('container-with-most-water')
  })

  it('includes the pattern only when explicitly requested', async () => {
    seedLog(ROW)
    const { port } = await listen(baseDeps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/history?patterns=1`)).json()) as {
      rows: { pattern?: string }[]
    }
    expect(body.rows[0]!.pattern).toBe('two-pointers')
  })

  it.each(['0', 'yes', 'true', ''])('withholds the pattern for patterns=%j', async (value) => {
    seedLog(ROW)
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/history?patterns=${value}`)).text()
    expect(body).not.toContain('two-pointers')
  })

  // Not gated behind ?patterns=1, unlike the pattern: a pairing session is
  // something he chose and sat through, so reporting that it happened spoils
  // nothing. It is on the wire because a cold solve of a paired problem is
  // weaker evidence of recall, and the screen leads with the cold count.
  it('reports which problems have been paired on, unconditionally', async () => {
    seedLog(ROW)
    appendCoached(root, {
      date: '2026-08-08',
      problem: 'container-with-most-water',
      pattern: 'two-pointers',
      minutes: 18,
    })
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/history`)).text()
    expect(JSON.parse(body).coached).toEqual(['container-with-most-water'])
    // And still without the pattern, even though `local/coached.md` records one.
    expect(body).not.toContain('two-pointers')
  })

  it('reports an empty coached list rather than omitting the field', async () => {
    seedLog(ROW)
    const { port } = await listen(baseDeps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/history`)).json()) as { coached: string[] }
    expect(body.coached).toEqual([])
  })

  it('is an empty history rather than an error when nothing has been drilled', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/history`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summary: { attempts: number }; rows: unknown[] }
    expect(body.rows).toEqual([])
    expect(body.summary.attempts).toBe(0)
  })
})

/**
 * Speech stops when the listener leaves.
 *
 * TTS runs on the server — `say`, a subprocess — so nothing about a reloaded or
 * closed page touches it, and the reply generator is deliberately drained to
 * completion even with no client attached. Together that left the interviewer
 * talking to an empty room after a refresh, and on the coding track
 * `beforeunload`'s `/end` beacon then started a whole closing verdict for
 * nobody. Reported from a real session: "when you refresh the page, audio is
 * still coming through".
 */
describe('nothing is spoken to an empty room', () => {
  /** Records what was spoken, and whether it was ever cut off. */
  function recordingSpeaker() {
    const spoken: string[] = []
    let stopped = 0
    return {
      spoken,
      stopCount: () => stopped,
      speaker: {
        speak: async (text: string) => {
          spoken.push(text)
        },
        stop: () => {
          stopped += 1
        },
      },
    }
  }

  // The `/end` beacon a refresh fires. Its closing turn exists for the
  // transcript and the drill-log trailer; there is nobody to hear it.
  it('does not speak a closing verdict when no client is attached', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const rec = recordingSpeaker()
    const { port } = await listen(
      baseDeps({
        speaker: rec.speaker,
        createTransport: () => async function* () {
          yield 'Here is the verdict.'
          yield '```drill-log\nsolved: no\nnote: refreshed away\n```'
        },
      }),
    )
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }
    const { relPath } = (await (
      await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    ).json()) as { relPath: string }

    expect(rec.spoken).toEqual([])
    // Silent, not skipped: the closing turn still happened, so the transcript and
    // the log row are exactly as they would have been.
    expect(readFileSync(join(root, relPath), 'utf8')).toContain('Here is the verdict.')
    expect(readFileSync(join(root, 'local/drill-log.md'), 'utf8')).toContain('refreshed away')
  })

  // The audible case: the page goes away *during* a reply.
  it('stops mid-turn when the page goes away, and speaks no further sentences', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const rec = recordingSpeaker()
    let onFirstSpoken = (): void => {}
    const firstSpoken = new Promise<void>((resolve) => {
      onFirstSpoken = resolve
    })
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const speaker = {
      speak: async (text: string) => {
        rec.spoken.push(text)
        // The first sentence parks in the speaker's mouth, which is where a real
        // one is when someone hits reload.
        if (rec.spoken.length === 1) {
          onFirstSpoken()
          await released
        }
      },
      stop: rec.speaker.stop,
    }
    const { port } = await listen(
      baseDeps({
        speaker,
        // Trailing spaces on purpose: `voice/chunk.ts` only treats a terminator
        // as ending a sentence when whitespace follows it, so without them these
        // three arrive as one blob and there is no per-sentence gate to observe.
        createTransport: () => async function* () {
          yield 'First sentence. '
          yield 'Second sentence. '
          yield 'Third sentence. '
        },
      }),
    )
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }

    // The opening turn is driven by the stream connection, so this is the turn
    // being spoken when the reload lands.
    const controller = new AbortController()
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`, { signal: controller.signal })
    await firstSpoken
    controller.abort()
    // Give the server's 'close' handler a tick to run before the speaker is let go.
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(rec.spoken).toEqual(['First sentence.'])
    expect(rec.stopCount()).toBeGreaterThan(0)
  })
})

/**
 * What conducted the drill, recorded in the transcript it leaves behind.
 *
 * The startup banner says what the *server* is on. A transcript read days later
 * needs to say what *that session* was on — on 2026-08-10 one read wrong and the
 * only way to guess the model was to compare the file's timestamp against the
 * commit that changed the default.
 */
describe('the transcript names its transport', () => {
  it('writes the backend and model into the header', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const { port } = await listen(baseDeps({ transportLabel: () => 'ollama / Qwen3.5:9b' }))
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }
    const { relPath } = (await (
      await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    ).json()) as { relPath: string }
    expect(readFileSync(join(root, relPath), 'utf8')).toContain('Interviewer: ollama / Qwen3.5:9b')
  })
})

/**
 * Ending a session exactly once.
 *
 * A real drill on 2026-08-10 produced two transcripts for one session — the
 * earlier one truncated mid-drill — and a drill-log row reading `00:00` for a
 * session whose own transcript stamped `[03:05]`. Both fell out of one hole:
 * POST /end awaits a closing interviewer turn, the session stays in the store
 * for all of it, and `store.get` is not a guard against a second caller. Two
 * client paths fire that endpoint and neither can see the other — the dock's
 * End session button and `beforeunload`'s `sendBeacon`.
 */
describe('POST /api/session/:id/end is not re-entrant', () => {
  /**
   * A closing turn that parks until released, so the second request provably
   * lands *inside* it.
   *
   * A `setTimeout` here would make this a timing test: neutering the fix and
   * re-running showed the second request sometimes arriving after the first had
   * already finished, which passes for the wrong reason. `entered` resolves when
   * the closing turn has actually started.
   */
  function pausedClosing(): { deps: VoiceServerDeps; entered: Promise<void>; release(): void } {
    let onEntered = (): void => {}
    let onRelease = (): void => {}
    const entered = new Promise<void>((resolve) => {
      onEntered = resolve
    })
    const released = new Promise<void>((resolve) => {
      onRelease = resolve
    })
    const deps = baseDeps({
      now: undefined,
      store: createSessionStore(() => 'session-1'),
      // Parks the *closing* turn specifically, spotted by the cue POST /end
      // interjects. Counting turns instead would depend on whether the opening
      // question has been driven yet, which is a different thing being tested.
      createTransport: () => async function* (_system, messages) {
        const last = messages[messages.length - 1]
        if (typeof last?.content === 'string' && last.content.includes('he has ended the session')) {
          onEntered()
          await released
        }
        yield 'That is where we will stop.\n```drill-log\nsolved: no\nnote: ran out of time\n```'
      },
    })
    return { deps, entered, release: () => onRelease() }
  }

  async function endTwiceInsideTheClosingTurn(port: number, harness: ReturnType<typeof pausedClosing>) {
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }
    const end = () => fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    const first = end()
    await harness.entered
    const second = await end()
    harness.release()
    return { first: await first, second }
  }

  it('writes one transcript for one session, not one per caller', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const harness = pausedClosing()
    const { port } = await listen(harness.deps)
    await endTwiceInsideTheClosingTurn(port, harness)
    // The transcript is the drill's product. Two files means one of them is a
    // truncated copy, and nothing on disk says which.
    expect(readdirSync(join(root, 'local/drills'))).toHaveLength(1)
  })

  it('answers 409 to the second caller rather than reporting a second success', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const harness = pausedClosing()
    const { port } = await listen(harness.deps)
    const { first, second } = await endTwiceInsideTheClosingTurn(port, harness)
    expect(second.status).toBe(409)
    expect(first.status).toBe(200)
  })

  // The row the racing pair produced in the real drill: `00:00`, because the
  // caller that had the closing verdict — and so the only one able to write a
  // row at all — read an entry clock its racing partner had already deleted.
  it('does not log a drill that ran for minutes as taking no time', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const harness = pausedClosing()
    const { port } = await listen(harness.deps)
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const first = fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    await harness.entered
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    harness.release()
    await first
    expect(readFileSync(join(root, 'local/drill-log.md'), 'utf8')).not.toContain('| 00:00 |')
  })

  // The number logged is how long *the drill* took. Read after the closing turn
  // it also absorbed the model's own minute — and read by a second finisher,
  // whose predecessor had already deleted the entry clock, it was `?? 0`.
  it("logs the drill's own elapsed time, not zero and not the closing turn", async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const harness = pausedClosing()
    const { port } = await listen(harness.deps)
    const { id } = (await (await startCodingSession(port)).json()) as { id: string }
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const ending = fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    await harness.entered
    // A closing turn far longer than the drill itself: if this leaks into the
    // logged time, the assertion below cannot pass by luck.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    harness.release()
    await ending
    const row = readFileSync(join(root, 'local/drill-log.md'), 'utf8')
    // Exactly one second: 1.1s of drill. `00:02` is this defect — the 1.5s
    // closing turn folded into Andre's time — and a range that admitted it is
    // what let an earlier version of this test pass against the unfixed server.
    expect(row).toContain('| 00:01 |')
  })
})

/**
 * Pairing runs the suite too.
 *
 * The pairing screen ships a **Run tests** button — half of a pairing session is
 * reading a red test together, and the coach is looking at the same
 * `solution.ts`. The route rejected the track with a 400 when the screen was
 * built, so the button did nothing; nothing covered it, which is why. Found while
 * adding the debugging track, which needed the same branch.
 */
describe('POST /api/session/:id/tests on the coach track', () => {
  it('runs the coding suite for a pairing session', async () => {
    const { port } = await listen(baseDeps({ runDrillTests: reports([]) }))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    const { id } = (await created.json()) as { id: string }
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/tests`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'green' })
  })

  // Nothing is rationed in a pairing session and the hint button is not on the
  // screen. A route that answered anyway would be a second door to a ladder the
  // track does not have.
  it('still has no hint ladder', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    const { id } = (await created.json()) as { id: string }
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/hint`, { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

/**
 * The coaching track, server side.
 *
 * Pairing rather than interviewing: the coach is handed the worked solution and
 * the pattern notes, plus the candidate's working file on every turn. The routes
 * the browser can call stay exactly as tight as they were — the spoilers reach
 * the model, never the page.
 */
describe('coach track', () => {
  it('lists the same problems as the coding track', async () => {
    const { port } = await listen(baseDeps())
    const coach = await (await fetch(`http://127.0.0.1:${port}/api/problems?track=coach`)).json()
    const coding = await (await fetch(`http://127.0.0.1:${port}/api/problems?track=coding`)).json()
    expect(coach).toEqual(coding)
  })

  it('serves the README, and only the README', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/${SLUG}?track=coach`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { problem: string; prompt: string }
    expect(body.problem).toBe(SLUG)
    expect(body.prompt).toContain('Given heights')
    // The worked solution is what makes coaching coaching, and it must still
    // never be reachable from the browser — a page cannot spoil a future
    // re-drill of the same problem.
    expect(JSON.stringify(body)).not.toMatch(/WORKED|SPOILER/i)
  })

  it('starts an untimed session with no budget', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { track: string; budgetMs?: number }
    expect(body.track).toBe('coach')
    // A clock turns pairing back into a test.
    expect(body.budgetMs).toBeUndefined()
  })

  // The session's own record. Not a drill-log row — see voice/coached.ts — so
  // this is the only place a coaching session leaves a trace besides its
  // transcript, and it is what stops a later cold solve reading as untainted.
  it('records the session in local/coached.md when it ends', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const { port } = await listen(baseDeps())
    await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    const ended = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'DELETE' })
    expect(ended.status).toBe(200)
    const body = readFileSync(join(root, 'local/coached.md'), 'utf8')
    expect(body).toContain(`| ${SLUG} |`)
    expect(body).toMatch(/\*\*Not attempts\.\*\*/)
    // The drill log is untouched: nobody was tested, so there is no attempt to
    // count and no cold-solve figure to dilute.
    expect(existsSync(join(root, 'local/drill-log.md'))).toBe(false)
  })

  it('rejects a coaching session with no problem', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach' }),
    })
    expect(res.status).toBe(400)
  })
})

/**
 * The code feed — the thing that makes this pairing rather than a friendlier
 * interview. Asserted through the transport, because the prompt is the only
 * place it can be observed.
 */
describe('coach sees the working file', () => {
  /** Opening the SSE stream is what drives the interviewer's first turn. */
  async function driveFirstTurn(port: number): Promise<void> {
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    await stream.body?.getReader().read()
  }

  it('hands the coach the current solution.ts, framed as state and not as speech', async () => {
    let messages: { role: string; content: string }[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system: string, msgs: { role: string; content: string }[]) {
          messages = msgs
          yield 'Right, let us look at it.'
        },
      }),
    )
    writeFileSync(join(root, `problems/${PATTERN}/${SLUG}/solution.ts`), 'const MARKER = 1\n')
    await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    await driveFirstTurn(port)

    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).toContain('const MARKER = 1')
    expect(joined).toMatch(/For you only, not spoken/)
    expect(joined).toMatch(/not a message from him/)
  })

  it('re-reads the file each turn rather than capturing it once', async () => {
    const seenPerTurn: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system: string, msgs: { role: string; content: string }[]) {
          seenPerTurn.push(msgs.map((m) => m.content).join('\n'))
          yield 'Go on.'
        },
        transcriber: { transcribe: async () => ({ text: 'I changed it.' }) },
        transcode: async () => {},
      }),
    )
    const solution = join(root, `problems/${PATTERN}/${SLUG}/solution.ts`)
    writeFileSync(solution, 'const FIRST = 1\n')
    await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coach', problem: SLUG }),
    })
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
    const reader = stream.body!.getReader()
    await reader.read()

    // He edits between turns — the whole reason the file is re-read.
    writeFileSync(solution, 'const SECOND = 2\n')
    await fetch(`http://127.0.0.1:${port}/api/session/session-1/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    })

    expect(seenPerTurn.length).toBeGreaterThanOrEqual(2)
    expect(seenPerTurn[0]).toContain('const FIRST = 1')
    expect(seenPerTurn[seenPerTurn.length - 1]).toContain('const SECOND = 2')
  })
})
