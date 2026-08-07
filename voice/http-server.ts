import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StreamFn } from './interviewer'
import type { Transcriber } from './speech'

export interface VoiceServerDeps {
  root: string
  createTransport(): StreamFn
  transcriber: Transcriber
  /** Milliseconds of inactivity before an orphaned session is reaped. Defaults to 5 minutes. */
  idleMs?: number
}

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8' },
}

function serveStatic(deps: VoiceServerDeps, pathname: string, res: ServerResponse): boolean {
  const entry = STATIC_FILES[pathname]
  if (!entry) return false
  const full = join(deps.root, 'voice/public', entry.file)
  if (!existsSync(full)) return false
  res.writeHead(200, { 'content-type': entry.contentType })
  res.end(readFileSync(full))
  return true
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(deps, url.pathname, res)) return

    notFound(res)
  })
}

/**
 * Owns the bind decision. A drill holds a live microphone and reads Andre's
 * private story bank, so the host is fixed at `127.0.0.1` here and is not a
 * parameter — a caller-supplied host would let someone bind `0.0.0.0` and
 * expose both to the network. `port` defaults to `0` (an OS-assigned port)
 * so tests can request an ephemeral one; it carries no security weight.
 */
export function startVoiceServer(deps: VoiceServerDeps, port = 0): Promise<Server> {
  const server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
