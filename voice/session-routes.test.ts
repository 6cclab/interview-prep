import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { readSSE } from './test-helpers/sse'

let server: Server | undefined
let root: string

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('.claude/commands/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
}

function baseDeps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  return {
    root,
    createTransport: () => async function* () {
      yield 'Ready when you are.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1'),
    now: () => 0,
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-server-'))
  seedContext()
})

afterEach(async () => {
  // A test can leave an SSE connection open on purpose (it's asserting on a
  // still-live stream) without ever aborting it. `server.close()` alone waits
  // for every open connection to end on its own, which would hang here
  // forever; `closeAllConnections()` drops them immediately so the suite can
  // move on.
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('POST /api/session', () => {
  it('creates a session and returns its id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'session-1' })
  })

  it('refuses a second session while one is already in progress', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))
    const first = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(first.status).toBe(201)
    const second = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(second.status).toBe(409)
    expect(((await second.json()) as { error: string }).error).toMatch(/already in progress/i)
  })
})

describe('POST /api/session/:id/turn', () => {
  it('transcodes, transcribes, and streams the interviewer reply to the open SSE connection', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'I would shard by tenant.' }) },
        transcode: async (_input, output) => {
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    await readSSE(stream) // opening entry

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: Buffer.from('fake webm bytes'),
    })
    expect(turnRes.status).toBe(202)
    expect(await turnRes.json()).toEqual({ text: 'I would shard by tenant.' })

    const andreEntry = await readSSE(stream)
    expect(andreEntry).toEqual({ event: 'entry', data: { speaker: 'andre', text: 'I would shard by tenant.', at: 0 } })

    const replySentence = await readSSE(stream)
    expect(replySentence).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'Tell me more.' } })
  })

  it('ends the session on a transcode failure and reports it over SSE', async () => {
    const { port } = await listen(
      baseDeps({
        transcode: async () => {
          throw new Error('ffmpeg: invalid data found')
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    await readSSE(stream)

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('garbage'),
    })
    expect(turnRes.status).toBe(422)

    const ended = await readSSE(stream)
    expect(ended.event).toBe('ended')
    expect((ended.data as { endedEarly: string | null }).endedEarly).toMatch(/ffmpeg/i)
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/turn`, { method: 'POST', body: Buffer.from('x') })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/session/:id/end', () => {
  it('persists the transcript and reports the path', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { relPath: string; storyLogWritten: boolean }
    expect(body.relPath).toMatch(/^local\/mock-\d{4}-\d{2}-\d{2}\.md$/)
    expect(existsSync(join(root, body.relPath))).toBe(true)
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/end`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('a second /end on the same id 404s — the session is already gone', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('idle reap', () => {
  it('reaps and persists a session nobody has touched within idleMs', async () => {
    let clock = 0
    const { port } = await listen(baseDeps({ now: () => clock, idleMs: 1000 }))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    clock = 5000
    // The sweep runs on its own interval; poll briefly for the file to appear
    // rather than asserting on internal timer state.
    const deadline = Date.now() + 2000
    let found = false
    while (Date.now() < deadline) {
      const files = existsSync(join(root, 'local'))
      if (files) {
        found = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(found).toBe(true)
    void id
  })
})

describe('the track/problem boundary', () => {
  it.each([
    { track: 'design', problem: 'rate-limiter' },
    { track: 'design', problem: '../../solutions/elimination/celebrity' },
    { track: 'mock', problem: '/etc/passwd' },
    { track: 'mock', problem: 'patterns.md' },
  ])('ignores a client-supplied track/problem and always builds the mock prompt: %j', async (payload) => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toBe('session-1')
    // No 500, no path-traversal error surfaced — the body is simply never read.
  })
})

describe('GET /api/session/:id/stream', () => {
  it('streams the opening turn as sentence events, then an entry event', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'What are we '
          yield 'optimising for?'
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')

    const first = await readSSE(stream)
    expect(first).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'What are we optimising for?' } })

    const second = await readSSE(stream)
    expect(second.event).toBe('entry')
    expect(second.data).toMatchObject({ speaker: 'interviewer', text: 'What are we optimising for?' })
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/stream`)
    expect(res.status).toBe(404)
  })

  it('a client disconnecting ends and persists the session', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const controller = new AbortController()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`, { signal: controller.signal })
    await readSSE(stream) // the opening sentence event, so the server has definitely started the turn
    controller.abort()

    // Give the server's 'close' handler a tick to run and persist.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const relPath = join(root, 'local/mock-' + new Date().toISOString().slice(0, 10) + '.md')
    expect(existsSync(relPath)).toBe(true)
  })
})
