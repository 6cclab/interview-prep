import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, parseDrill, startVoiceServer } from './http-server'
import { readSSE } from './test-helpers/sse'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

let server: Server | undefined
let distDir: string | undefined
let root: string

/**
 * A throwaway repo root, seeded with just the files `context.ts` reads.
 *
 * These tests must NOT be rooted at `process.cwd()`. Ending a session persists
 * its transcript to `<root>/local/`, so a real-repo root made the suite write
 * into Andre's actual drill log on every run — and because a mock transcript
 * used to be named by date alone, that overwrote any real session from the same
 * day. Note the clock is a separate concern: the point of the tests below is
 * that they run the *unmodified production clock*, and a temp root does not
 * weaken that at all.
 */
function seededRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voice-http-'))
  const seed = (relPath: string, body: string) => {
    const full = join(dir, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('prompts/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
  return dir
}

beforeEach(() => {
  root = seededRoot()
})

afterEach(async () => {
  // A test can leave an SSE connection open on purpose without ever aborting
  // it. `server.close()` alone waits for every open connection to end on its
  // own, which would hang here; `closeAllConnections()` drops them immediately.
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  if (distDir) rmSync(distDir, { recursive: true, force: true })
  distDir = undefined
  rmSync(root, { recursive: true, force: true })
})

/** A small fixture dist directory, standing in for a real `vite build` output. */
function fixtureDistDir(): string {
  distDir = mkdtempSync(join(tmpdir(), 'voice-dist-'))
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Voice mock drill</title>')
  return distDir
}

function listen(): Promise<{ port: number }> {
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

describe('createVoiceServer', () => {
  // `startVoiceServer` owns the bind decision (see http-server.ts), so this
  // test exercises it directly instead of a test-local `.listen()` call --
  // otherwise it would only prove that Node did what the test told it, not
  // that the server binds itself to 127.0.0.1.
  it('binds to 127.0.0.1, never 0.0.0.0', async () => {
    server = await startVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const address = server.address()
    expect(address === null || typeof address === 'string' ? null : address.address).toBe('127.0.0.1')
  })

  it('serves the page at GET /', async () => {
    server = createVoiceServer({
      root,
      distDir: fixtureDistDir(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<title>')
  })

  it('404s an unknown path', async () => {
    server = createVoiceServer({
      root,
      distDir: fixtureDistDir(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
  })

  // Regression for a bug where the production path stamped `Entry.at` with
  // raw `Date.now()` (absolute epoch milliseconds) instead of elapsed time
  // since the session started. `Entry.at` is analytic data — `transcript.ts`
  // renders it as `[mm:ss]` and the drill grades pacing off it — so an epoch
  // stamp renders as minutes in the millions.
  //
  // Deliberately no `now` override anywhere in these deps: a test that
  // injects a clock (as every other test in this file and session-routes.test
  // does) cannot exercise this class of bug at all, because the injected
  // clock is exactly what a broken production default hides behind. This
  // test exercises the real, unmodified default the way `main()` actually
  // constructs it.
  it('stamps Entry.at with elapsed time from the unmodified production clock, not epoch time', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {
        yield 'Tell me about a time you disagreed with a decision.'
      },
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    const entryEvent = await readSSE(stream) // opening entry
    expect(entryEvent.event).toBe('entry')

    const at = (entryEvent.data as { at: number }).at
    // Elapsed-since-start over the lifetime of this fast, synchronous test
    // stays well under a second. An absolute epoch stamp would be on the
    // order of 1.7e12 — five orders of magnitude larger — so this bound
    // cleanly distinguishes the two without being flaky about test speed.
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(10_000)
  })

  // A single "elapsed since server start" default would fix the first
  // session on a long-running server and silently reintroduce drift for
  // every session after it — a smaller, sneakier version of the same bug:
  // the second session's opening entry would start at however long the
  // server had already been up, not at 0. Sessions here are sequential (only
  // one may be active at a time), so this reaches through a full
  // create -> end -> create cycle on one live server, with the production
  // clock, and holds both sessions to the same near-zero bound.
  it('does not let a second sequential session inherit the first session elapsed time', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {
        yield 'Ready when you are.'
      },
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()

    const firstEntryAt = async (): Promise<number> => {
      const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
      const { id } = (await created.json()) as { id: string }
      const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
      await readSSE(stream) // opening sentence
      const entryEvent = await readSSE(stream) // opening entry
      const at = (entryEvent.data as { at: number }).at
      await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
      return at
    }

    const first = await firstEntryAt()
    // A real gap between sessions, well past the tight bound below — long
    // enough that "elapsed since server start" and "elapsed since this
    // session's own start" would visibly disagree if the server were reusing
    // one shared clock across sessions.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const second = await firstEntryAt()

    expect(first).toBeLessThan(200)
    expect(second).toBeLessThan(200)
  })
})

describe('device routes', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voice-devices-http-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('GET /api/devices/output lists devices from the injected lister, never a real `say`', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
      listOutputDevices: async () => [{ id: '75', name: 'MacBook Pro Speakers' }],
      // The list only means anything when the server is the thing speaking,
      // so the route asks for a speaker before it asks the host about hardware.
      speaker: { speak: async () => {} },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/output`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      devices: [{ id: '75', name: 'MacBook Pro Speakers' }],
      serverSpeaks: true,
    })
  })

  // Deployed, `deps.speaker` is undefined and the browser speaks for itself
  // (see `voice/web/src/browserVoice.ts`). Enumerating output devices then
  // asks a container about hardware it does not have, and offering a speaker
  // picker would offer a choice over audio nobody is in the room to hear.
  it('GET /api/devices/output reports serverSpeaks false and no devices when nothing speaks server-side', async () => {
    let listed = false
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
      listOutputDevices: async () => {
        listed = true
        return [{ id: '75', name: 'MacBook Pro Speakers' }]
      },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/output`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ devices: [], serverSpeaks: false })
    expect(listed).toBe(false)
  })

  it('GET /api/devices/output surfaces a lister failure as a 500 rather than crashing the server', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
      listOutputDevices: async () => {
        throw new Error('say -a ? failed')
      },
      speaker: { speak: async () => {} },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/output`)
    expect(res.status).toBe(500)
  })

  it('GET /api/devices/config returns an empty config when nothing has been saved', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/config`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('POST /api/devices/config persists output and webInput, and a later GET reflects it', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const post = await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '75', webInput: 'browser-device-1' }),
    })
    expect(post.status).toBe(200)
    expect(await post.json()).toEqual({ output: '75', webInput: 'browser-device-1' })

    const get = await fetch(`http://127.0.0.1:${port}/api/devices/config`)
    expect(await get.json()).toEqual({ output: '75', webInput: 'browser-device-1' })
  })

  it('POST /api/devices/config merges rather than clobbering a field it was not given (e.g. cli.ts\'s input)', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '75' }),
    })
    const second = await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webInput: 'browser-device-1' }),
    })
    expect(await second.json()).toEqual({ output: '75', webInput: 'browser-device-1' })
  })

  it('POST /api/devices/config 400s on a malformed body rather than throwing', async () => {
    server = createVoiceServer({
      root,
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('server-side TTS (deps.speaker)', () => {
  // This deliberately does not assert ordering between a `speak` call and the
  // client's own observation of the matching SSE event: `res.write()` is
  // synchronous and `speaker.speak()` is called on the very next line, so a
  // mock speaker's own bookkeeping runs *before* the written bytes have made
  // it across a real loopback socket back to this test's `fetch` reader —
  // asserting the client sees the SSE event first would be asserting away a
  // real network hop, not testing this module. What's actually testable and
  // load-bearing: (1) speak calls never overlap, (2) they happen in sentence
  // order, and (3) the first sentence reaches the client without waiting for
  // its own (slow) TTS call to finish — proof the write isn't gated on
  // playback.
  it('speaks each sentence in order, never overlapping, and delivers a sentence over SSE without waiting on its own TTS call', async () => {
    const SPEAK_DELAY_MS = 300
    const speakOrder: string[] = []
    let inFlight = 0
    let sawOverlap = false
    const speaker = {
      async speak(text: string): Promise<void> {
        inFlight++
        if (inFlight > 1) sawOverlap = true
        speakOrder.push(text)
        await new Promise((resolve) => setTimeout(resolve, SPEAK_DELAY_MS))
        inFlight--
      },
    }

    server = createVoiceServer({
      root,
      createTransport: () => async function* () {
        // Trailing spaces matter here: `SentenceBuffer` (chunk.ts) only
        // confirms a sentence boundary once whitespace follows the
        // terminator — concatenated deltas with no space between them would
        // read as one run-on sentence and never separate into two `sentence`
        // events at all.
        yield 'First sentence. '
        yield 'Second sentence.'
      },
      transcriber: { transcribe: async () => ({ text: '' }) },
      speaker,
    })
    const { port } = await listen()

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const streamStartedAt = Date.now()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)

    const first = await readSSE(stream)
    const firstReceivedMs = Date.now() - streamStartedAt
    expect((first.data as { text: string }).text).toBe('First sentence.')
    // A generous margin under SPEAK_DELAY_MS: if the write were gated behind
    // `await speaker.speak(...)`, this would take at least 300ms, not a
    // handful. Loose enough not to flake under CI load, tight enough to
    // catch the write actually being stalled.
    expect(firstReceivedMs).toBeLessThan(SPEAK_DELAY_MS / 2)

    const second = await readSSE(stream)
    expect((second.data as { text: string }).text).toBe('Second sentence.')
    await readSSE(stream) // opening entry, once both sentences have been spoken

    expect(sawOverlap).toBe(false)
    expect(speakOrder).toEqual(['First sentence.', 'Second sentence.'])
  })

  it('a speaker that throws does not kill the session or drop the transcript', async () => {
    const speaker = {
      async speak(): Promise<void> {
        throw new Error('say: device vanished')
      },
    }

    server = createVoiceServer({
      root,
      createTransport: () => async function* () {
        yield 'Tell me about a time you disagreed with a decision.'
      },
      transcriber: { transcribe: async () => ({ text: '' }) },
      speaker,
    })
    const { port } = await listen()

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    const sentence = await readSSE(stream)
    expect((sentence.data as { text: string }).text).toBe('Tell me about a time you disagreed with a decision.')
    const entry = await readSSE(stream)
    expect(entry.event).toBe('entry')
    expect((entry.data as { text: string }).text).toBe('Tell me about a time you disagreed with a decision.')
  })
})

describe('parseDrill — the editing mode', () => {
  it('accepts an editor mode on a coding drill', () => {
    expect(parseDrill({ track: 'coding', problem: 'valid-palindrome', editor: 'browser' }))
      .toMatchObject({ editor: 'browser' })
  })

  it("defaults to the candidate's own editor when unspecified", () => {
    expect(parseDrill({ track: 'coding', problem: 'valid-palindrome' }).editor).toBeUndefined()
  })

  it('rejects an unknown editor mode rather than coercing it', () => {
    expect(() => parseDrill({ track: 'coding', problem: 'valid-palindrome', editor: 'vim' }))
      .toThrow(/editor/i)
  })
})
