import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSystemPrompt } from './context'
import { createInterviewer, type StreamFn } from './interviewer'
import { createSession } from './session'
import { createSessionStore, type SessionStore } from './session-store'
import type { Transcriber } from './speech'

export interface VoiceServerDeps {
  root: string
  createTransport(): StreamFn
  transcriber: Transcriber
  store?: SessionStore
  /** Milliseconds since the epoch, injectable so tests don't depend on wall time. */
  now?(): number
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not found' })
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  const store = deps.store ?? createSessionStore()
  const now = deps.now ?? Date.now

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(deps, url.pathname, res)) return

    if (req.method === 'POST' && url.pathname === '/api/session') {
      // No request body is read here: the design track is out of scope for
      // this plan, so there is no client-supplied `track` or `problem` for
      // this boundary to validate. If `/design` is ever added here,
      // `context.ts`'s `PROBLEM_SLUG` and `assertNoSpoilers` must run on
      // whatever arrives before it reaches `buildSystemPrompt`.
      if (store.hasActive()) {
        sendJson(res, 409, { error: 'a session is already in progress' })
        return
      }
      const system = buildSystemPrompt(deps.root, 'mock')
      const interviewer = createInterviewer(system, deps.createTransport())
      const session = createSession({ interviewer, now: () => now() })
      const scratchDir = mkdtempSync(join(tmpdir(), 'voice-web-'))
      const stored = store.create(session, interviewer, new Date(), scratchDir)
      sendJson(res, 201, { id: stored.id })
      return
    }

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
