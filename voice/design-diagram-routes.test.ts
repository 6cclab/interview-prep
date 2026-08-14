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
let captured: { role: string; content: string }[] = []

const PROBLEM = 'rate-limiter'

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('prompts/design.md', 'DESIGN COMMAND')
  seed(`system-design/${PROBLEM}/README.md`, '# Rate limiter\n\nDesign one.\n')
  seed(`system-design/${PROBLEM}/rubric.md`, '## Estimation\n\nnumbers appear\n')
  // Seeded on purpose: it is a DENIED spoiler, and a root without one cannot
  // show that it stays unread.
  seed(`system-design/${PROBLEM}/reference.md`, 'WORKED-DESIGN-SPOILER token-bucket')
}

function deps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = (): number => 0
  return {
    root,
    createTransport: () => async function* (_system: string, msgs: { role: string; content: string }[]) {
      captured = msgs
      yield 'Talk me through it.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
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

const startDesign = (port: number) =>
  fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: 'design', problem: PROBLEM }),
  })

const putDiagram = (port: number, diagram: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/session/session-1/diagram`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diagram }),
  })

/** The opening interviewer turn fires when the stream is opened, not before. */
async function openStream(port: number): Promise<void> {
  const stream = await fetch(`http://127.0.0.1:${port}/api/session/session-1/stream`)
  await stream.body?.getReader().read()
}

const DIAGRAM = {
  nodes: [
    { id: 'c', type: 'client', label: 'Mobile app' },
    { id: 'q', type: 'queue', label: 'Token bucket' },
  ],
  edges: [{ from: 'c', to: 'q', label: 'requests' }],
}

beforeEach(() => {
  captured = []
  root = mkdtempSync(join(tmpdir(), 'design-diagram-'))
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

describe('PUT /api/session/:id/diagram', () => {
  it('accepts the diagram on the canvas', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    expect((await putDiagram(port, DIAGRAM)).status).toBe(200)
  })

  // It is interpolated into the interviewer's prompt, so an unchecked shape is
  // prompt content nobody wrote arriving from the client.
  it('refuses something that is not a diagram', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    expect((await putDiagram(port, { nodes: 'no' })).status).toBe(400)
  })

  it('refuses an edge pointing at a component that is not there', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    const dangling = { nodes: [{ id: 'a', type: 'client', label: 'App' }], edges: [{ from: 'a', to: 'ghost' }] }
    expect((await putDiagram(port, dangling)).status).toBe(400)
  })

  it('404s for a session that does not exist', async () => {
    const { port } = await listen(deps())
    expect((await putDiagram(port, DIAGRAM)).status).toBe(404)
  })
})

describe('the diagram as a turn cue', () => {
  it('tells the interviewer what is on the canvas, framed as state and not as speech', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    await putDiagram(port, DIAGRAM)
    await openStream(port)

    const joined = captured.map((m) => m.content).join('\n')
    expect(joined).toContain('Mobile app (client)')
    expect(joined).toContain('Mobile app -> Token bucket (requests)')
    // The same framing coach.ts uses, for the same reason: a model must not
    // mistake the canvas for something he said out loud.
    expect(joined).toMatch(/For you only, not spoken/)
  })

  it('says the canvas is empty rather than sending nothing', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    await openStream(port)
    // An interviewer that silently receives nothing starts describing a design
    // that is not on the screen — codeCue's reasoning, same failure.
    expect(captured.map((m) => m.content).join('\n')).toMatch(/has not drawn anything/)
  })

  it('never lets the worked design reach the interviewer', async () => {
    const { port } = await listen(deps())
    await startDesign(port)
    await putDiagram(port, DIAGRAM)
    await openStream(port)
    expect(captured.map((m) => m.content).join('\n')).not.toContain('WORKED-DESIGN-SPOILER')
  })
})
