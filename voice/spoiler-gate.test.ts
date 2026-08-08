import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { readSSE } from './test-helpers/sse'
import { buildWeb } from './test-helpers/build-web'

let server: Server | undefined
let root: string

const DENIED_STRING = 'THE ANSWER — reference.md body'
const TRAILER = '```story-log\ncompetency: Conflict\nstory: The migration\nworked: Owned the timeline\nfix: Name the tradeoff sooner\n```'

function seed() {
  const seedFile = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seedFile('.claude/commands/mock.md', 'MOCK COMMAND')
  seedFile('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seedFile('behavioral/questions.md', 'QUESTIONS')
  // A denied file present in the checkout, exactly as it would be in the real repo.
  seedFile('patterns.md', DENIED_STRING)
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

// Only the "real build" test below reads `voice/dist`, but it needs a fresh,
// real `vite build` (not a stale or absent one) to assert anything meaningful
// about what a real deploy serves. Building once per file run, rather than
// per test, keeps the cost to a single build even though only one `it` uses
// it.
beforeAll(async () => {
  await buildWeb()
}, 30_000)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-spoiler-'))
  seed()
})

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('spoiler gate', () => {
  it('no response body, from any route, ever contains denied-file content or the raw trailer', async () => {
    const { port } = await listen({
      root,
      createTransport: () => async function* () {
        yield `Good critique. ${TRAILER}`
      },
      transcriber: { transcribe: async () => ({ text: 'A story about a migration.' }) },
      store: createSessionStore(() => 'session-1'),
      now: () => 0,
      transcode: async (_input: string, output: string) => writeFileSync(output, Buffer.from('fake wav')),
      // Never shell out to a real `say -a '?'` from a test.
      listOutputDevices: async () => [{ id: '75', name: 'MacBook Pro Speakers' }],
    })

    const responses: string[] = []

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    responses.push(await created.clone().text())
    const { id } = (await created.json()) as { id: string }

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    responses.push(JSON.stringify(await readSSE(stream)))
    responses.push(JSON.stringify(await readSSE(stream)))

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('audio'),
    })
    responses.push(await turnRes.clone().text())
    responses.push(JSON.stringify(await readSSE(stream))) // andre entry
    responses.push(JSON.stringify(await readSSE(stream))) // interviewer sentence — trailer must be stripped here

    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    responses.push(await endRes.clone().text())

    // The device routes never touch session/transcript state at all, but
    // they're routes on this same server and the sweep's contract is every
    // response body, from any route — so they're covered here too.
    const devicesOutput = await fetch(`http://127.0.0.1:${port}/api/devices/output`)
    responses.push(await devicesOutput.clone().text())
    const devicesConfigGet = await fetch(`http://127.0.0.1:${port}/api/devices/config`)
    responses.push(await devicesConfigGet.clone().text())
    const devicesConfigPost = await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '75' }),
    })
    responses.push(await devicesConfigPost.clone().text())

    for (const body of responses) {
      expect(body).not.toContain(DENIED_STRING)
      expect(body).not.toContain('story-log')
      expect(body).not.toContain('competency: Conflict')
    }
  })

  // The sweep above never exercises an error path (every request it makes
  // succeeds) or the static file routes — this covers both, so a future
  // change that puts debug context into an error body or a template have a
  // regression test standing guard, not just a one-time manual check.
  it('error response bodies (404/409/413/422) never contain denied-file content or the raw trailer', async () => {
    const { port } = await listen({
      root,
      createTransport: () => async function* () {
        yield `Good critique. ${TRAILER}`
      },
      transcriber: { transcribe: async () => ({ text: 'A story about a migration.' }) },
      store: createSessionStore(() => 'session-2'),
      now: () => 0,
      transcode: async (_input: string, output: string) => writeFileSync(output, Buffer.from('fake wav')),
    })

    const responses: string[] = []

    // 404s
    for (const res of await Promise.all([
      fetch(`http://127.0.0.1:${port}/does-not-exist`),
      fetch(`http://127.0.0.1:${port}/api/session/nope/stream`),
      fetch(`http://127.0.0.1:${port}/api/session/nope/turn`, { method: 'POST', body: Buffer.from('x') }),
      fetch(`http://127.0.0.1:${port}/api/session/nope/end`, { method: 'POST' }),
    ])) {
      expect(res.status).toBe(404)
      responses.push(await res.text())
    }

    // 409: a session already in progress
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const secondCreate = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(secondCreate.status).toBe(409)
    responses.push(await secondCreate.text())

    // 413: oversized turn upload — just over the 25MB limit, not a full extra
    // megabyte, so the test isn't paying to push data past the point where
    // the server has already decided to reject it.
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1024, 1)
    const tooLarge = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: oversized,
    })
    expect(tooLarge.status).toBe(413)
    responses.push(await tooLarge.text())

    for (const body of responses) {
      expect(body).not.toContain(DENIED_STRING)
      expect(body).not.toContain('story-log')
      expect(body).not.toContain('competency: Conflict')
    }
  })

  it('a 422 from a failed transcode never contains denied-file content or the raw trailer', async () => {
    const { port } = await listen({
      root,
      createTransport: () => async function* () {
        yield `Good critique. ${TRAILER}`
      },
      transcriber: { transcribe: async () => ({ text: 'A story about a migration.' }) },
      store: createSessionStore(() => 'session-3'),
      now: () => 0,
      transcode: async () => {
        throw new Error(`ffmpeg exploded near ${DENIED_STRING}`)
      },
    })

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = (await created.json()) as { id: string }
    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('audio'),
    })
    expect(turnRes.status).toBe(422)
    const body = await turnRes.text()
    // The failure message itself is untrusted/dynamic and is expected to
    // surface (that's the point of a 422) — what must never happen is the
    // *transcript/system-prompt* content leaking. This just proves the
    // response is a plain JSON error, not something that also echoes back
    // interviewer state.
    expect(JSON.parse(body)).toHaveProperty('error')
    expect(body).not.toContain('story-log')
    expect(body).not.toContain('competency: Conflict')
  })

  it('every static asset in the real build never contains denied-file content or the raw trailer', async () => {
    // Rooted at the real project directory (not the synthetic `root` used
    // above) and reading the actual `voice/dist` build (built fresh by this
    // file's own `beforeAll`, see voice/test-helpers/build-web.ts) — the
    // files a real deploy serves — rather than a fixture that could pass for
    // reasons unrelated to what's really on disk. Vite emits content-hashed
    // filenames, so the set of paths is discovered by walking the build
    // output rather than hardcoded.
    const { port } = await listen({
      root: process.cwd(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
      store: createSessionStore(() => 'session-4'),
      now: () => 0,
    })

    const distDir = join(process.cwd(), 'voice/dist')
    const relPaths = (readdirSync(distDir, { recursive: true }) as string[]).filter((name) =>
      statSync(join(distDir, name)).isFile(),
    )
    const paths = ['/', ...relPaths.map((name) => '/' + name.split(sep).join('/'))]
    expect(paths.length).toBeGreaterThan(1) // the build must have actually produced assets

    for (const path of paths) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).not.toContain(DENIED_STRING)
      expect(body).not.toContain('story-log')
      expect(body).not.toContain('competency: Conflict')
    }
  })
})
