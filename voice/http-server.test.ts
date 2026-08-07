import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, startVoiceServer } from './http-server'
import { readSSE } from './test-helpers/sse'

let server: Server | undefined
let distDir: string | undefined

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
      root: process.cwd(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const address = server.address()
    expect(address === null || typeof address === 'string' ? null : address.address).toBe('127.0.0.1')
  })

  it('serves the page at GET /', async () => {
    server = createVoiceServer({
      root: process.cwd(),
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
      root: process.cwd(),
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
      root: process.cwd(),
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
      root: process.cwd(),
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
