import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'

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
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
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
