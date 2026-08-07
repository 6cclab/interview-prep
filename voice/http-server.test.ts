import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createVoiceServer, startVoiceServer } from './http-server'

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

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
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
  })
})
