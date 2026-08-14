import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

let server: Server | undefined
let root: string
let spoken: string[] = []

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('prompts/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
}

function deps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = (): number => 0
  return {
    root,
    createTransport: () => async function* () {
      yield 'Tell me about a time you disagreed.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
    speaker: {
      speak: async (text: string) => {
        spoken.push(text)
      },
      stop: () => {},
    },
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

const AS_ALICE = { 'x-authentik-uid': 'ak-alice' }

async function startAndStream(port: number, headers: Record<string, string> = {}): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST', headers })
  const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`, { headers })
  await stream.body?.getReader().read()
}

beforeEach(() => {
  spoken = []
  root = mkdtempSync(join(tmpdir(), 'deployed-audio-'))
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

/**
 * The hazard: `voice/speech.ts` spawns `say` or `piper | ffplay` on the machine
 * the server runs on, and the client has no playback code. Deployed unchanged,
 * every user's interviewer speaks out of the server's own audio device.
 */
describe('a deployed instance does not speak', () => {
  it('never drives the server\'s speaker for a remote user', async () => {
    const { port } = await listen(deps({ mode: 'deployed' }))
    await startAndStream(port, AS_ALICE)
    expect(spoken).toEqual([])
  })

  it('still sends the words, so the browser can say them', async () => {
    const seen: string[] = []
    const { port } = await listen(deps({ mode: 'deployed' }))
    await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST', headers: AS_ALICE })
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`, { headers: AS_ALICE })
    const chunk = await stream.body?.getReader().read()
    seen.push(new TextDecoder().decode(chunk?.value))
    // Silencing the server must not silence the interview — the text still has
    // to arrive, or a deployed drill is a blank screen.
    expect(seen.join('')).toContain('disagreed')
  })

  it('keeps speaking on a local instance, which is the whole point of it', async () => {
    const { port } = await listen(deps())
    await startAndStream(port)
    expect(spoken.join(' ')).toContain('disagreed')
  })
})

/**
 * These select the *server's* audio hardware. That is a coherent thing to
 * offer when the server is the machine you are sitting at, and an incoherent
 * one the moment it is not.
 */
describe('the device routes on a deployed instance', () => {
  it('refuses to list the server\'s speakers to a remote user', async () => {
    const { port } = await listen(deps({ mode: 'deployed' }))
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/output`, { headers: AS_ALICE })
    expect(res.status).toBe(410)
  })

  it('refuses to let a remote user change the server\'s output device', async () => {
    const { port } = await listen(deps({ mode: 'deployed' }))
    const res = await fetch(`http://127.0.0.1:${port}/api/devices/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AS_ALICE },
      body: JSON.stringify({ output: 'someone elses speakers' }),
    })
    expect(res.status).toBe(410)
  })

  it('leaves them working locally, where they mean something', async () => {
    const { port } = await listen(deps())
    expect((await fetch(`http://127.0.0.1:${port}/api/devices/config`)).status).toBe(200)
  })
})
