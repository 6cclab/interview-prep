import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  // The default store must be built against the same clock the server ends
  // up using, so a test that only overrides `now` (like the idle-reap test
  // below) doesn't silently get a store stamping `lastActivity` off the real
  // wall clock instead.
  const now = overrides.now ?? ((): number => 0)
  return {
    root,
    createTransport: () => async function* () {
      yield 'Ready when you are.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
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

// The recovery path for the 409 above: POST /api/session's 409 body never
// carries the stuck session's id, so a client that hits it has no id to end
// it with via the existing POST /api/session/:id/end. This lets it end
// whichever session the server currently considers active instead.
describe('DELETE /api/session', () => {
  it('404s when no session is active', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('ends the active session and clears the way for a new one', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(created.status).toBe(201)

    const stuck = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(stuck.status).toBe(409)

    const deleted = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)

    const retried = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(retried.status).toBe(201)
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

  // A transcription failure is recoverable, not session-ending: whisper.cpp
  // hiccuping on turn 6 of a drill must not cost Andre the whole session. See
  // the "transcription failure recovery" describe block below for the full
  // retry/abandon surface.
  it('a transcode failure does not end the session, and does not add a phantom transcript entry', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({
        store,
        transcode: async () => {
          throw new Error('ffmpeg: invalid data found')
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    const openingEntry = await readSSE(stream)

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('garbage'),
    })
    expect(turnRes.status).toBe(422)
    expect(((await turnRes.json()) as { error: string }).error).toMatch(/ffmpeg/i)

    // No 'ended' event, and no synthetic entry landed on the still-open
    // stream — the interviewer's question still stands and the transcript
    // is exactly what it was before the failed turn.
    expect(store.get(id)).toBeDefined()
    void openingEntry

    // The session is still usable: a normal /end still works, and produces a
    // transcript with no synthetic "[Session ended early — ...]" entry.
    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(endRes.status).toBe(200)
    const { relPath } = (await endRes.json()) as { relPath: string }
    const transcript = readFileSync(join(root, relPath), 'utf8')
    expect(transcript).not.toContain('Session ended early')
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/turn`, { method: 'POST', body: Buffer.from('x') })
    expect(res.status).toBe(404)
  })

  it('rejects a second POST /turn for the same session while the first is still in flight', async () => {
    let releaseTranscode: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseTranscode = resolve
    })
    const { port } = await listen(
      baseDeps({
        transcode: async (_input, output) => {
          await gate
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    await readSSE(stream)

    const first = fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    // Give the server a moment to accept the first request and mark the turn
    // in flight before the second one lands.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('another turn'),
    })
    expect(second.status).toBe(409)
    expect(((await second.json()) as { error: string }).error).toMatch(/already in progress/i)

    releaseTranscode()
    expect((await first).status).toBe(202)
  })

  it('accepts a turn with no live SSE connection open and leaves the session usable', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'answer' }) },
        transcode: async (_input, output) => {
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    // Deliberately no GET /stream — the zero-client path. `stored.sseClient`
    // is `undefined` for the whole request.
    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(turnRes.status).toBe(202)
    expect(await turnRes.json()).toEqual({ text: 'answer' })

    // Give the fire-and-forget reply-stream IIFE a moment to drain to
    // completion with nowhere to write — it must not throw or hang.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The session must not be left wedged: a normal /end still works.
    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(endRes.status).toBe(200)
  })
})

describe('transcription failure recovery', () => {
  it('retry after a transcode failure re-transcodes, succeeds, and produces exactly one entry', async () => {
    const store = createSessionStore(() => 'session-1')
    let transcodeCalls = 0
    const { port } = await listen(
      baseDeps({
        store,
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'I would shard by tenant.' }) },
        transcode: async (_input, output) => {
          transcodeCalls++
          if (transcodeCalls === 1) throw new Error('ffmpeg: invalid data found')
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    await readSSE(stream) // opening entry

    const failed = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(failed.status).toBe(422)
    expect(((await failed.json()) as { error: string }).error).toMatch(/ffmpeg/i)

    // The failed turn's webm is retained (transcode never succeeded, so
    // there's no wav to prefer), and the session is still usable.
    const retained = store.get(id)!.retainedAudio
    expect(retained?.kind).toBe('webm')
    expect(existsSync(retained!.path)).toBe(true)

    const retryRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/retry`, { method: 'POST' })
    expect(retryRes.status).toBe(202)
    expect(await retryRes.json()).toEqual({ text: 'I would shard by tenant.' })
    expect(transcodeCalls).toBe(2)

    const andreEntry = await readSSE(stream)
    expect(andreEntry).toEqual({ event: 'entry', data: { speaker: 'andre', text: 'I would shard by tenant.', at: 0 } })
    const replySentence = await readSSE(stream)
    expect(replySentence).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'Tell me more.' } })
    await readSSE(stream) // interviewer entry

    // Exactly one Andre entry landed, not two (the failed attempt) and not
    // zero — and the retained audio is gone now that the retry succeeded.
    const entries = store.get(id)!.session.entries()
    expect(entries.filter((e) => e.speaker === 'andre')).toHaveLength(1)
    expect(store.get(id)!.retainedAudio).toBeUndefined()
    expect(existsSync(retained!.path)).toBe(false)
  })

  it('a transcribe failure (transcode already succeeded) retains the wav, and retry skips re-transcoding', async () => {
    const store = createSessionStore(() => 'session-1')
    let transcodeCalls = 0
    let transcribeCalls = 0
    const { port } = await listen(
      baseDeps({
        store,
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: {
          transcribe: async () => {
            transcribeCalls++
            if (transcribeCalls === 1) throw new Error('whisper-cli: model not found')
            return { text: 'I would shard by tenant.' }
          },
        },
        transcode: async (_input, output) => {
          transcodeCalls++
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const failed = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(failed.status).toBe(422)
    expect(((await failed.json()) as { error: string }).error).toMatch(/whisper/i)

    const retained = store.get(id)!.retainedAudio
    expect(retained?.kind).toBe('wav')
    expect(transcodeCalls).toBe(1)

    const retryRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/retry`, { method: 'POST' })
    expect(retryRes.status).toBe(202)
    // Retrying from an already-transcoded wav must not re-invoke transcode.
    expect(transcodeCalls).toBe(1)
    expect(transcribeCalls).toBe(2)
  })

  it('a retry that fails again stays recoverable — 422, session alive, still retryable', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({
        store,
        transcriber: { transcribe: async () => { throw new Error('whisper-cli: crashed') } },
        transcode: async (_input, output) => writeFileSync(output, Buffer.from('fake wav bytes')),
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const failed = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(failed.status).toBe(422)

    const retryRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/retry`, { method: 'POST' })
    expect(retryRes.status).toBe(422)
    expect(store.get(id)).toBeDefined()
    expect(store.get(id)!.retainedAudio).toBeDefined()

    // Not an escalation: a second retry is still possible, and a normal
    // /end still works.
    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(endRes.status).toBe(200)
  })

  it('a second failed turn replaces the first retained audio, deleting the old file', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({
        store,
        transcode: async () => { throw new Error('ffmpeg: first failure') },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('first webm') })
    const firstRetained = store.get(id)!.retainedAudio!
    expect(existsSync(firstRetained.path)).toBe(true)

    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('second webm') })
    const secondRetained = store.get(id)!.retainedAudio!
    expect(secondRetained.path).not.toBe(firstRetained.path)
    expect(existsSync(firstRetained.path)).toBe(false)
    expect(existsSync(secondRetained.path)).toBe(true)
  })

  it('POST .../turn/retry 409s when nothing is retained', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/retry`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('POST .../turn/retry 404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/turn/retry`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST .../turn/abandon drops the retained audio and leaves the session usable for a fresh recording', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({
        store,
        transcode: async () => { throw new Error('ffmpeg: invalid data found') },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('webm') })
    const retained = store.get(id)!.retainedAudio!
    expect(existsSync(retained.path)).toBe(true)

    const abandonRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/abandon`, { method: 'POST' })
    expect(abandonRes.status).toBe(200)
    expect(store.get(id)!.retainedAudio).toBeUndefined()
    expect(existsSync(retained.path)).toBe(false)

    // A fresh recording ("Answer again") is a normal turn, nothing special.
    const normalTurn = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('x') })
    expect(normalTurn.status).not.toBe(404)
  })

  it('POST .../turn/abandon is idempotent when nothing is retained', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/abandon`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('POST .../turn/abandon 404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/turn/abandon`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  // Retained audio must not accumulate past a session's lifetime, however it
  // ends — normal /end, an SSE disconnect, and the idle reap sweep are three
  // independently-coded exit paths (see endAndPersist's callers).
  it('retained audio does not survive a normal session end', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({ store, transcode: async () => { throw new Error('ffmpeg: fail') } }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('x') })
    const retained = store.get(id)!.retainedAudio!
    expect(existsSync(retained.path)).toBe(true)

    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(existsSync(retained.path)).toBe(false)
  })

  it('retained audio does not survive an SSE disconnect ending the session', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({ store, transcode: async () => { throw new Error('ffmpeg: fail') } }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('x') })
    const retained = store.get(id)!.retainedAudio!
    expect(existsSync(retained.path)).toBe(true)

    const controller = new AbortController()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`, { signal: controller.signal })
    await readSSE(stream) // opening sentence
    controller.abort()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(existsSync(retained.path)).toBe(false)
  })

  it('retained audio does not survive an idle reap', async () => {
    const store = createSessionStore(() => 'session-1')
    let clock = 0
    const { port } = await listen(
      baseDeps({ store, now: () => clock, idleMs: 1000, transcode: async () => { throw new Error('ffmpeg: fail') } }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('x') })
    const retained = store.get(id)!.retainedAudio!
    expect(existsSync(retained.path)).toBe(true)

    clock = 5000
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && store.get(id)) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(store.get(id)).toBeUndefined()
    expect(existsSync(retained.path)).toBe(false)
  })
})

describe('scratch directory cleanup', () => {
  it('removes the session scratch directory on POST /end', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(baseDeps({ store }))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const scratchDir = store.get(id)!.scratchDir
    expect(existsSync(scratchDir)).toBe(true)

    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(existsSync(scratchDir)).toBe(false)
  })

  it('removes the session scratch directory when an SSE disconnect ends the session', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(baseDeps({ store }))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const scratchDir = store.get(id)!.scratchDir
    expect(existsSync(scratchDir)).toBe(true)

    const controller = new AbortController()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`, { signal: controller.signal })
    await readSSE(stream)
    controller.abort()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(existsSync(scratchDir)).toBe(false)
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

  it('a second connection ends the previous response instead of leaving it open', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const first = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(first) // the opening sentence
    await readSSE(first) // the opening entry — both are written before the reconnect below

    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(second.status).toBe(200)

    // The first response must have been ended by the server, not merely
    // abandoned — reading past everything it had already buffered should
    // observe the stream closing rather than hang waiting for bytes nobody
    // will ever write.
    await expect(readSSE(first)).rejects.toThrow(/stream ended/i)
  })

  it('a reconnect replaces the stream but keeps the session alive and usable', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'answer' }) },
        transcode: async (_input, output) => {
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const first = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(first) // opening sentence
    await readSSE(first) // opening entry — both are written before the reconnect below

    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(second.status).toBe(200)

    // Ending the first response fires *its own* already-registered 'close'
    // handler. Give it a tick to run: it must not tear the session down out
    // from under the reconnect (that was the regression).
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The session must still be alive and usable: a turn submitted after the
    // reconnect streams to the *new* connection.
    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(turnRes.status).toBe(202)

    const andreEntry = await readSSE(second)
    expect(andreEntry).toEqual({ event: 'entry', data: { speaker: 'andre', text: 'answer', at: 0 } })
    const replySentence = await readSSE(second)
    expect(replySentence).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'Tell me more.' } })

    // And the session is still in the store — a genuine end still works,
    // rather than the reconnect having already silently ended it (a 404 here
    // would mean the regression is back).
    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(endRes.status).toBe(200)
  })
})
