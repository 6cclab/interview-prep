import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * The debugging track's HTTP surface.
 *
 * What separates it from the coding track, and what each of these is about:
 *
 * - **Two suites, and the pair of greens is the verdict.** `repro` green with
 *   `invariant` red is a symptom patch — the finding the exercise exists to
 *   produce — and it must never reach the interviewer as progress.
 * - **The interviewer has no answer to ration.** The worked answer is
 *   `solutions/debugging/<exercise>.md`, denied for every track, and the bug is in
 *   `src/**`, which no route serves and no prompt includes. So the ladder runs out
 *   after rung 1 and the server says so rather than letting a model invent a
 *   module.
 * - **It writes the same drill-log table as the coding track**, with `Pattern` set
 *   to `debugging` per `debug.md`, because `/status` reads exactly one log.
 */

let server: Server | undefined
let root: string

const EXERCISE = 'loyalty-discount'

function seed(relPath: string, body: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

function seedContext() {
  seed('prompts/debug.md', 'DEBUG COMMAND')
  seed(`debugging/${EXERCISE}/README.md`, '# Bug report: loyalty discount is inconsistent\n\nSupport escalated this.\n')
  seed(`debugging/${EXERCISE}/meta.yaml`, 'title: Loyalty discount is inconsistent\ndomains:\n  - checkout\n')
  seed(`debugging/${EXERCISE}/repro.test.ts`, 'export {}')
  seed(`debugging/${EXERCISE}/invariant.test.ts`, 'export {}')
  // The bug and the answer, both seeded on purpose: a root with no spoiler in it
  // cannot demonstrate that the spoiler stays unread.
  seed(`debugging/${EXERCISE}/src/discount-service.ts`, 'export const PLANTED_BUG_LIVES_HERE = true')
  seed(`solutions/debugging/${EXERCISE}.md`, 'ROOT-CAUSE-SPOILER: shared mutable module state')
  seed('debugging/entitlements-gate/README.md', '# Bug report: entitlements\n')
  seed('debugging/entitlements-gate/meta.yaml', 'title: Customer sees a feature they never bought\n')
}

/** A vitest stand-in: writes the report a real run of the two suites would have written. */
function reports(failures: { file: 'repro.test.ts' | 'invariant.test.ts'; titles: string[] }[]) {
  return async (_args: string[], _cwd: string, reportPath: string) => {
    writeFileSync(
      reportPath,
      JSON.stringify({
        testResults: failures.map((entry) => ({
          name: `${root}/debugging/${EXERCISE}/${entry.file}`,
          assertionResults: entry.titles.map((title) => ({
            status: 'failed',
            title,
            ancestorTitles: ['checkout'],
          })),
        })),
      }),
    )
  }
}

function baseDeps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = overrides.now ?? ((): number => 0)
  return {
    root,
    createTransport: () => async function* () {
      yield 'What do you think is happening, and what would prove it?'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
    runDebugTests: reports([]),
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

async function startDebugSession(port: number, exercise = EXERCISE): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: 'debug', problem: exercise }),
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-debug-'))
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

describe('GET /api/problems?track=debug', () => {
  it('lists exercises by name, with the bug report headline as the title', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems?track=debug`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      problems: ['entitlements-gate', EXERCISE],
      titles: {
        'entitlements-gate': 'Customer sees a feature they never bought',
        [EXERCISE]: 'Loyalty discount is inconsistent',
      },
    })
  })

  it('falls back to the name when meta.yaml has no title', async () => {
    seed('debugging/untitled-thing/README.md', '# Bug report\n')
    const { port } = await listen(baseDeps())
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/problems?track=debug`)).json()) as {
      titles: Record<string, string>
    }
    expect(body.titles['untitled-thing']).toBe('untitled-thing')
  })
})

describe('GET /api/problems/:exercise?track=debug', () => {
  it('serves the bug report', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/${EXERCISE}?track=debug`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { problem: string; prompt: string }
    expect(body.problem).toBe(EXERCISE)
    expect(body.prompt).toContain('Support escalated this')
  })

  // The two things a browser must never be able to fetch: the planted bug, and
  // the worked answer. Neither is on any route, and the second is denied outright.
  it('serves neither the source nor the worked answer', async () => {
    const { port } = await listen(baseDeps())
    const body = await (await fetch(`http://127.0.0.1:${port}/api/problems/${EXERCISE}?track=debug`)).text()
    expect(body).not.toContain('PLANTED_BUG_LIVES_HERE')
    expect(body).not.toContain('ROOT-CAUSE-SPOILER')
  })

  it('404s an exercise that does not exist', async () => {
    const { port } = await listen(baseDeps())
    expect((await fetch(`http://127.0.0.1:${port}/api/problems/nope?track=debug`)).status).toBe(404)
  })
})

describe('POST /api/session on the debug track', () => {
  it('starts a timed session', async () => {
    const { port } = await listen(baseDeps())
    const res = await startDebugSession(port)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { track: string; problem: string; budgetMs?: number }
    expect(body).toMatchObject({ track: 'debug', problem: EXERCISE })
    expect(body.budgetMs).toBe(45 * 60 * 1000)
  })

  it('rejects a debugging session with no exercise', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'debug' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s an unknown exercise rather than creating a session', async () => {
    const { port } = await listen(baseDeps())
    expect((await startDebugSession(port, 'no-such-exercise')).status).toBe(400)
  })

  // The prompt is where a spoiler would do the most damage, because it reaches the
  // interviewer rather than the screen. `assertNoSpoilers` covers
  // `solutions/debugging/**` by the `^solutions/` rule; the source is excluded by
  // `allowedPaths` naming only two files.
  it('builds a prompt from the bug report and the command file, and nothing else', async () => {
    const prompts: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (system) {
          prompts.push(system)
          yield 'What do you think is happening?'
        },
      }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('DEBUG COMMAND')
    expect(prompts[0]).toContain('Bug report: loyalty discount')
    expect(prompts[0]).not.toContain('PLANTED_BUG_LIVES_HERE')
    expect(prompts[0]).not.toContain('ROOT-CAUSE-SPOILER')
  })
})

describe('POST /api/session/:id/tests on the debug track', () => {
  async function runTests(port: number, id: string) {
    return fetch(`http://127.0.0.1:${port}/api/session/${id}/tests`, { method: 'POST' })
  }

  it('reports both suites green as the root cause', async () => {
    const { port } = await listen(baseDeps({ runDebugTests: reports([]) }))
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    expect(await (await runTests(port, id)).json()).toEqual({ kind: 'root-cause' })
  })

  // The whole point of the track. A verdict that reported this as "1 of 2 passing"
  // would teach the exact thing debug.md forbids.
  it('reports repro-green-invariant-red as a symptom patch', async () => {
    const { port } = await listen(
      baseDeps({ runDebugTests: reports([{ file: 'invariant.test.ts', titles: ['holds across flows'] }]) }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    expect(await (await runTests(port, id)).json()).toEqual({
      kind: 'symptom-patch',
      failed: ['checkout > holds across flows'],
    })
  })

  it('reports a still-failing repro as unfixed', async () => {
    const { port } = await listen(
      baseDeps({ runDebugTests: reports([{ file: 'repro.test.ts', titles: ['assigns the discount'] }]) }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    expect(((await (await runTests(port, id)).json()) as { kind: string }).kind).toBe('unfixed')
  })

  // The verdict reaches the interviewer as a bracketed aside, never as something
  // Andre said — and pressing a button is not speech, so no Andre entry is written.
  it('tells the interviewer what the verdict means, and writes no candidate entry', async () => {
    const turns: string[][] = []
    const { port } = await listen(
      baseDeps({
        runDebugTests: reports([{ file: 'invariant.test.ts', titles: ['holds'] }]),
        createTransport: () => async function* (_system, messages) {
          turns.push(messages.map((m) => (typeof m.content === 'string' ? m.content : '')))
          yield 'That is a symptom patch. '
        },
      }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    await runTests(port, id)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const lastTurn = turns.at(-1)!.join('\n')
    expect(lastTurn).toContain('[Test result, for you only:')
    expect(lastTurn).toContain('symptom patch')

    const entries = (await (await fetch(`http://127.0.0.1:${port}/api/session/${id}`)).json()) as {
      entries: { speaker: string; text: string }[]
    }
    expect(entries.entries.filter((entry) => entry.speaker === 'andre')).toEqual([])
    // And the cue itself never becomes a transcript entry.
    expect(JSON.stringify(entries.entries)).not.toContain('for you only')
  })
})

/**
 * The ladder that runs out.
 *
 * Rung 1 is a question about the reported behaviour, which the interviewer can ask
 * from the bug report alone. Every rung past it names part of the defect, and the
 * defect is in files this track deliberately never shows it. So the honest answer
 * is that there is no more help — and, crucially, a refusal is not recorded as
 * help taken, because that number is what `/status` reads to tell rust from
 * coverage.
 */
describe('POST /api/session/:id/hint on the debug track', () => {
  async function askHint(port: number, id: string) {
    return (await fetch(`http://127.0.0.1:${port}/api/session/${id}/hint`, { method: 'POST' })).json() as Promise<{
      rung: number
      servable: boolean
    }>
  }

  it('gives rung 1, then reports that there is nothing further it can give', async () => {
    const { port } = await listen(baseDeps())
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    expect(await askHint(port, id)).toEqual({ rung: 1, servable: true })
    expect(await askHint(port, id)).toEqual({ rung: 1, servable: false })
    expect(await askHint(port, id)).toEqual({ rung: 1, servable: false })
  })

  it('tells the interviewer to refuse plainly rather than guess at a module', async () => {
    const turns: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system, messages) {
          const last = messages.at(-1)
          turns.push(typeof last?.content === 'string' ? last.content : '')
          yield 'I cannot narrow it further. '
        },
      }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    await askHint(port, id)
    await new Promise((resolve) => setTimeout(resolve, 60))
    await askHint(port, id)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const refusal = turns.at(-1)!
    expect(refusal).toContain('more help than you can give')
    expect(refusal).toMatch(/Do not guess at a module, a file or a cause/)
    // Rung 1's own cue must not name anything either.
    expect(turns.at(-2)!).toMatch(/Do not name a file, a module or a function/)
  })
})

describe('ending a debug session', () => {
  it('writes its transcript under local/debugging and a drill-log row with pattern debugging', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    const { port } = await listen(
      baseDeps({
        now: undefined,
        store: createSessionStore(() => 'session-1'),
        createTransport: () => async function* () {
          yield 'You patched the symptom. '
          yield '```drill-log\nsolved: no\nnote: symptom patch on the first attempt\n```'
        },
      }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    const { relPath } = (await (
      await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    ).json()) as { relPath: string }

    expect(relPath).toMatch(/^local\/debugging\/loyalty-discount-live-/)
    expect(readdirSync(join(root, 'local/debugging'))).toHaveLength(1)
    const row = readFileSync(join(root, 'local/drill-log.md'), 'utf8')
    // `debug.md`: append with `Pattern` set to `debugging`. One log, both tracks —
    // `/status` and the history screen read exactly one file.
    expect(row).toContain(`| ${EXERCISE} | debugging |`)
    expect(row).toContain('symptom patch on the first attempt')
  })

  // The trailer is the interviewer's judgement only. A closing turn that never
  // happened is how the coding track ended up logging nothing for any drill that
  // did not run the full clock.
  it('drives a closing turn so a row exists even when he ends early', async () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    let turns = 0
    const { port } = await listen(
      baseDeps({
        now: undefined,
        store: createSessionStore(() => 'session-1'),
        createTransport: () => async function* () {
          turns += 1
          yield 'Closing. '
          yield '```drill-log\nsolved: yes\nnote: root cause, found it from the invariant\n```'
        },
      }),
    )
    const { id } = (await (await startDebugSession(port)).json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(turns).toBeGreaterThan(0)
    expect(readFileSync(join(root, 'local/drill-log.md'), 'utf8')).toContain('root cause, found it')
  })
})
