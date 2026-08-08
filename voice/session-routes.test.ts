import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { connect } from 'node:net'
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
  // The design track. `reference.md` is seeded on purpose: it is a DENIED
  // spoiler, and a test root without one cannot show that it stays unread.
  seed('.claude/commands/design.md', 'DESIGN COMMAND')
  seed('system-design/rate-limiter/README.md', '# Rate limiter\n\nDesign a rate limiter.\n')
  seed('system-design/rate-limiter/rubric.md', '## Estimation\n\nnumbers appear\n')
  seed('system-design/rate-limiter/reference.md', 'WORKED-DESIGN-SPOILER token-bucket')
  seed('system-design/notification-fanout/README.md', '# Fanout\n\nDesign a fanout.\n')
  seed('system-design/notification-fanout/rubric.md', '## Estimation\n\nnumbers appear\n')
  seed('system-design/notification-fanout/reference.md', 'WORKED-DESIGN-SPOILER')
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
    expect(await res.json()).toEqual({ id: 'session-1', track: 'mock' })
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

  // Without these two fields the 409 is a dead end for "Open that session":
  // there is no id to reopen, and the banner has no honest start time to name.
  it('names the session it refused, with its start time, so the client can reopen it', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))
    const first = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await first.json()) as { id: string }

    const conflict = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(conflict.status).toBe(409)
    const body = (await conflict.json()) as { id: string; startedAt: string }
    expect(body.id).toBe(id)
    // A real ISO instant for the refused session, not the time of the refusal.
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false)
    expect(body.startedAt).toBe(store.get(id)!.startedAt.toISOString())
  })
})

// Reopening a session the browser lost track of. SSE replays nothing, so
// reattaching to the stream alone would show an empty transcript for a session
// several turns deep — this is where the client catches up from.
describe('GET /api/session/:id', () => {
  it('reports the session identity and its committed entries', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'Tell me about a disagreement.'
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    await readSSE(stream) // opening entry, so an entry is definitely committed

    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      startedAt: string
      entries: { speaker: string; text: string; at: number }[]
      awaitingRetry: boolean
    }
    expect(body.id).toBe(id)
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false)
    expect(body.entries).toEqual([
      { speaker: 'interviewer', text: 'Tell me about a disagreement.', at: 0 },
    ])
    expect(body.awaitingRetry).toBe(false)
  })

  // A reopened session must land in the same error state it was left in, or
  // Andre loses the retained audio's retry without ever being offered it.
  it('reports awaitingRetry when a turn failed transcription and its audio is retained', async () => {
    const { port } = await listen(
      baseDeps({
        transcode: async () => {
          throw new Error('ffmpeg: invalid data found')
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

    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}`)
    expect(((await res.json()) as { awaitingRetry: boolean }).awaitingRetry).toBe(true)
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope`)
    expect(res.status).toBe(404)
  })

  // The naming scheme separates transcripts by start time to the minute, which
  // is not a uniqueness guarantee: "End it and start fresh" (the stuck-session
  // banner) ends one session and immediately starts another, so two can share a
  // stamp. `writeSession`'s refusal to overwrite is what keeps that safe, and
  // this drives the whole flow through the real routes rather than trusting the
  // unit test of the fallback in isolation.
  it('keeps both transcripts when a session is ended and restarted inside the same minute', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))

    const firstCreate = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id: firstId } = (await firstCreate.json()) as { id: string }
    const firstEnd = await fetch(`http://127.0.0.1:${port}/api/session/${firstId}/end`, { method: 'POST' })
    const { relPath: firstPath } = (await firstEnd.json()) as { relPath: string }

    const secondCreate = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(secondCreate.status).toBe(201)
    const { id: secondId } = (await secondCreate.json()) as { id: string }
    const secondEnd = await fetch(`http://127.0.0.1:${port}/api/session/${secondId}/end`, { method: 'POST' })
    const { relPath: secondPath } = (await secondEnd.json()) as { relPath: string }

    // Two distinct files, both still on disk, and each reported path is the one
    // that actually exists — a reported path that isn't there is the specific
    // way this fix could half-work.
    expect(secondPath).not.toBe(firstPath)
    expect(existsSync(join(root, firstPath))).toBe(true)
    expect(existsSync(join(root, secondPath))).toBe(true)
  })

  // The whole point of reopening: the entries survive so a reattached client can
  // render the transcript it missed, and reattaching does not disturb them.
  it('keeps reporting the full transcript across a reconnect', async () => {
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
    await readSSE(first)
    await readSSE(first)
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, { method: 'POST', body: Buffer.from('webm') })
    await readSSE(first) // Andre's entry
    await readSSE(first) // the reply's sentence
    await readSSE(first) // the interviewer's entry

    // Reattach, exactly as "Open that session" does.
    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(second.status).toBe(200)
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}`)
    const { entries } = (await res.json()) as { entries: { speaker: string }[] }
    expect(entries.map((e) => e.speaker)).toEqual(['interviewer', 'andre', 'interviewer'])
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

  // Recording again is a way out of the error state that doesn't go through
  // retry or abandon — the primary action stays live under the banner. If the
  // superseded audio survived that, a later retry would append a second entry
  // stamped with the *earlier* turn's `at`, landing out of order in the record
  // the drill grades pacing off.
  it('a normal turn succeeding after a failure clears the superseded retained audio', async () => {
    const store = createSessionStore(() => 'session-1')
    let transcodeCalls = 0
    const { port } = await listen(
      baseDeps({
        store,
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'Second, better answer.' }) },
        transcode: async (_input, output) => {
          transcodeCalls++
          if (transcodeCalls === 1) throw new Error('ffmpeg: invalid data found')
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }

    const failed = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('first webm'),
    })
    expect(failed.status).toBe(422)
    const stale = store.get(id)!.retainedAudio!
    expect(existsSync(stale.path)).toBe(true)

    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('second webm'),
    })
    expect(second.status).toBe(202)

    expect(store.get(id)!.retainedAudio).toBeUndefined()
    expect(existsSync(stale.path)).toBe(false)

    // And so a retry has nothing to resurrect: exactly one Andre entry stands.
    const retryRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn/retry`, { method: 'POST' })
    expect(retryRes.status).toBe(409)
    const entries = store.get(id)!.session.entries()
    expect(entries.filter((e) => e.speaker === 'andre')).toHaveLength(1)
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
    expect(body.relPath).toMatch(/^local\/mock-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)
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
  // The design track is now in scope, so this boundary changed shape: the body
  // IS read, which means a hostile `problem` reaches a path-building function
  // and must be rejected outright rather than sanitised into something that
  // happens to be harmless. A 400 with no session created is the contract; a
  // 201 for any of these would mean a traversal attempt was tolerated.
  it.each([
    { track: 'design', problem: '../../solutions/elimination/celebrity' },
    { track: 'design', problem: '/etc/passwd' },
    { track: 'design', problem: 'patterns.md' },
    { track: 'design', problem: 'rate-limiter/../../..' },
    { track: 'design', problem: '' },
    { track: 'design' },
    { track: 'coding', problem: 'rate-limiter' },
    { track: 'design', problem: 'rate-limiter', budgetMinutes: 0 },
    { track: 'design', problem: 'rate-limiter', budgetMinutes: 'forty-five' },
  ])('rejects an invalid drill request without creating a session: %j', async (payload) => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(baseDeps({ store }))
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(400)
    // Nothing was created, so a following valid request is not blocked by a
    // half-built session sitting in the store.
    expect(store.hasActive()).toBe(false)
  })

  // A slug that is well-formed but names nothing is the client asking for a
  // problem that does not exist — a 400, not a 500, and no session either.
  it('rejects a well-formed problem slug that does not exist', async () => {
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(baseDeps({ store }))
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'no-such-problem' }),
    })
    expect(res.status).toBe(400)
    expect(store.hasActive()).toBe(false)
  })

  // Reading the request body means yielding to the event loop for as long as
  // the client takes to finish sending it. If the single-session check happens
  // before that yield and the create after it, two concurrent requests can both
  // pass the check — which is why the check and the create must sit in the same
  // synchronous run. Driven over a raw socket because `fetch` will not let a
  // body dribble out in two writes, and dribbling is exactly the case.
  it('refuses a concurrent create even when the first request body arrives in pieces', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))

    const body = JSON.stringify({ track: 'mock' })
    const slow = connect(port, '127.0.0.1')
    await new Promise<void>((resolve) => slow.once('connect', resolve))
    const slowStatus = new Promise<string>((resolve) => {
      slow.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8').split('\r\n')[0]!))
    })
    // Headers plus the first byte of the body, then a pause: the server is now
    // parked inside `readJsonBody` awaiting the rest.
    slow.write(
      `POST /api/session HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.slice(0, 1)}`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A second, complete request lands while the first is still mid-body.
    const second = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })

    slow.write(body.slice(1))
    const firstStatus = await slowStatus
    slow.destroy()

    // Exactly one of the two won; the other got a 409. Both winning would leave
    // two live sessions, which every recovery path in this server assumes cannot
    // happen.
    const statuses = [firstStatus.includes('201'), second.status === 201]
    expect(statuses.filter(Boolean)).toHaveLength(1)
    expect(firstStatus.includes('409') || second.status === 409).toBe(true)
  })

  it('defaults to the mock track when no body is sent at all', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'session-1', track: 'mock' })
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
    // Matched by prefix rather than by exact name: the transcript is named from
    // the session's real start time down to the minute, which this test does not
    // control. What it is asserting is that a disconnect persisted *something*.
    const today = new Date().toISOString().slice(0, 10)
    const written = readdirSync(join(root, 'local')).filter((name) => name.startsWith(`mock-${today}`))
    expect(written).toHaveLength(1)
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

  // The harder case than the one above: the reconnect lands *while* a turn's
  // reply is mid-stream, so the in-flight write loop is holding the response
  // the reconnect is about to end. This interleaving was only ever verified by
  // an ad hoc script during review — a real drill hits it whenever the laptop
  // sleeps or the wifi blips mid-answer, and what it guards against is the
  // whole session dying rather than one truncated sentence.
  it('a reconnect landing mid-reply keeps the session alive and completes the in-flight turn', async () => {
    let releaseTail: () => void = () => {}
    const tailGate = new Promise<void>((resolve) => {
      releaseTail = resolve
    })
    let calls = 0
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          calls++
          if (calls === 1) {
            yield 'Ready when you are.'
            return
          }
          // The reply to the turn below, deliberately paused between sentences
          // so the reconnect can land while this generator is still running.
          // Two sentences in this one delta on purpose: `interviewer.ts` holds
          // back the last couple of characters of every delta so a story-log
          // fence split across deltas can still be detected, which means a
          // delta ending in its own terminator emits nothing until the next one
          // arrives. A second sentence here gives the first one something to be
          // confirmed by, so it reaches the wire before the gate.
          yield 'That is one option. Say more about the tradeoff.'
          await tailGate
          yield 'What did it cost you?'
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
    await readSSE(first) // opening entry

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    expect(turnRes.status).toBe(202)
    await readSSE(first) // Andre's entry
    await readSSE(first) // the reply's first sentence — the turn is now parked mid-stream

    // Reconnect while that generator is still suspended.
    const second = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(second.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 20))

    releaseTail()

    // The turn finishes and commits its interviewer entry, which lands on the
    // *new* connection. The tail sentence written to the superseded response is
    // lost — the accepted cost of a dropped connection — but losing it must not
    // throw, wedge the turn, or take the session with it.
    const interviewerEntry = await readSSE(second)
    expect(interviewerEntry.event).toBe('entry')
    expect(interviewerEntry.data).toMatchObject({ speaker: 'interviewer' })

    // `turnsInFlight` was released, so a further turn is accepted rather than
    // 409ing forever — a leak there wedges the session permanently.
    const nextTurn = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('another webm'),
    })
    expect(nextTurn.status).toBe(202)

    // And the persisted transcript has the whole reply, including the sentence
    // that streamed after the reconnect: the wire lost it, the record did not.
    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(endRes.status).toBe(200)
    const { relPath } = (await endRes.json()) as { relPath: string }
    const transcript = readFileSync(join(root, relPath), 'utf8')
    expect(transcript).not.toContain('Session ended early')
    expect(transcript).toContain('What did it cost you?')
  })
})

describe('the design track', () => {
  it('creates a design session and reports the drill it started', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'rate-limiter' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'session-1',
      track: 'design',
      problem: 'rate-limiter',
      budgetMs: 45 * 60 * 1000,
    })
  })

  it('honours a custom budget, per design.md 45 minutes "unless he says otherwise"', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'rate-limiter', budgetMinutes: 30 }),
    })
    const { budgetMs } = (await res.json()) as { budgetMs: number }
    expect(budgetMs).toBe(30 * 60 * 1000)
  })

  // The transcript has to land where `/design` looks for it. Filing a design
  // session as `local/mock-...` would lose it from the track's own history,
  // which is what a second attempt at the same problem reads to see what the
  // first one missed.
  it('files a design transcript under local/designs, named for the problem', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'rate-limiter' }),
    })
    const { id } = (await created.json()) as { id: string }

    const ended = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    const { relPath } = (await ended.json()) as { relPath: string }
    expect(relPath).toMatch(/^local\/designs\/rate-limiter-live-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)
    expect(existsSync(join(root, relPath))).toBe(true)
  })

  // The interviewer has no clock, and design.md tells it to warn at ten minutes
  // and stop at time. Without the cue those instructions are unfollowable, so
  // this asserts the cue actually reaches the model — and, just as importantly,
  // that it does not reach the transcript.
  it('feeds the interviewer a time check each turn, and keeps it out of the transcript', async () => {
    const seen: string[] = []
    const store = createSessionStore(() => 'session-1')
    const { port } = await listen(
      baseDeps({
        store,
        createTransport: () => async function* (_system, messages) {
          seen.push(messages[messages.length - 1]!.content)
          yield 'What are we optimising for?'
        },
        transcriber: { transcribe: async () => ({ text: 'Ten thousand writes a second.' }) },
        transcode: async (_input, output) => {
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'rate-limiter' }),
    })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    await readSSE(stream) // opening entry

    await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('fake webm bytes'),
    })
    await readSSE(stream) // Andre's entry
    await readSSE(stream) // the reply

    // Both turns — the opening and Andre's answer — carried a time check.
    expect(seen).toHaveLength(2)
    for (const message of seen) expect(message).toMatch(/Time check, for you only: 45 minutes/)
    // And Andre's own words reached the model intact alongside it.
    expect(seen[1]).toContain('Ten thousand writes a second.')

    // The transcript is a record of what was said. The cue was never said.
    const entries = store.get(id)!.session.entries()
    for (const entry of entries) expect(entry.text).not.toContain('Time check')
    expect(entries.find((e) => e.speaker === 'andre')!.text).toBe('Ten thousand writes a second.')
  })

  it('does not feed a time check on the untimed mock track', async () => {
    const seen: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system, messages) {
          seen.push(messages[messages.length - 1]!.content)
          yield 'Tell me about a disagreement.'
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    await readSSE(stream)
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain('Time check')
  })

  // A custom budget has to reach the *cue*, not just the response body. If it
  // only reached the body, the header would count down the right thing while the
  // interviewer paced against 45 minutes regardless — a disagreement invisible
  // from either side alone.
  it('paces the interviewer against a custom budget, not the default', async () => {
    const seen: string[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* (_system, messages) {
          seen.push(messages[messages.length - 1]!.content)
          yield 'What are we optimising for?'
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'rate-limiter', budgetMinutes: 20 }),
    })
    const { id } = (await created.json()) as { id: string }
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    await readSSE(stream)

    expect(seen[0]).toContain('20 minutes of the 20 remain')
    expect(seen[0]).not.toContain('45')
  })

  it('reports the drill back on GET /api/session/:id, so a reopen restores the pane and clock', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'design', problem: 'notification-fanout', budgetMinutes: 20 }),
    })
    const { id } = (await created.json()) as { id: string }

    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}`)
    const body = (await res.json()) as { track: string; problem: string; budgetMs: number }
    expect(body.track).toBe('design')
    expect(body.problem).toBe('notification-fanout')
    expect(body.budgetMs).toBe(20 * 60 * 1000)
  })
})

describe('GET /api/problems', () => {
  it('lists the design problems by name', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ problems: ['notification-fanout', 'rate-limiter'] })
  })

  it('serves a problem statement for the design pane', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/rate-limiter`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { problem: string; prompt: string }
    expect(body.problem).toBe('rate-limiter')
    expect(body.prompt).toContain('Design a rate limiter.')
  })

  // The problem directory also holds `reference.md` — a worked design, and a
  // DENIED spoiler. The prompt route reads one named file from that directory,
  // so it is exactly where a mistake would surface the answer.
  it('never serves the reference design or the rubric', async () => {
    const { port } = await listen(baseDeps())
    const prompt = await fetch(`http://127.0.0.1:${port}/api/problems/rate-limiter`)
    const body = await prompt.text()
    expect(body).not.toContain('WORKED-DESIGN-SPOILER')
    expect(body).not.toContain('numbers appear')

    for (const path of [
      '/api/problems/rate-limiter/reference.md',
      '/api/problems/rate-limiter%2Freference.md',
      '/api/problems/..%2F..%2Fpatterns.md',
      '/api/problems/rate-limiter%2F..%2F..%2Fsolutions',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(res.status).not.toBe(200)
      expect(await res.text()).not.toContain('WORKED-DESIGN-SPOILER')
    }
  })

  it('404s a problem that does not exist', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems/no-such-problem`)
    expect(res.status).toBe(404)
  })
})
