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

    for (const body of responses) {
      expect(body).not.toContain(DENIED_STRING)
      expect(body).not.toContain('story-log')
      expect(body).not.toContain('competency: Conflict')
    }
  })
})
