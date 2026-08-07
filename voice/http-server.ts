import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSystemPrompt } from './context'
import { createInterviewer, type StreamFn } from './interviewer'
import { createSession, finishSession } from './session'
import { createSessionStore, type SessionStore } from './session-store'
import type { Transcriber } from './speech'
import { transcodeToWav } from './transcode'

export interface VoiceServerDeps {
  root: string
  createTransport(): StreamFn
  transcriber: Transcriber
  store?: SessionStore
  /** Milliseconds since the epoch, injectable so tests don't depend on wall time. */
  now?(): number
  /** Milliseconds of inactivity before an orphaned session is reaped. Defaults to 5 minutes. */
  idleMs?: number
  /** Injectable so tests never spawn a real ffmpeg process. */
  transcode?(inputPath: string, outputPath: string): Promise<void>
}

// A recorded interview turn is at most a few minutes of audio; 25MB is a wide
// margin over that even at a generous bitrate. Reading an unbounded body
// straight into memory is a trivial way for a single request to exhaust it.
const MAX_TURN_AUDIO_BYTES = 25 * 1024 * 1024

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

function writeSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function streamTurn(res: ServerResponse, turn: AsyncIterable<string>): Promise<void> {
  for await (const sentence of turn) {
    writeSSE(res, 'sentence', { speaker: 'interviewer', text: sentence })
  }
}

function endAndPersist(deps: VoiceServerDeps, store: SessionStore, id: string): void {
  const stored = store.get(id)
  if (!stored) return
  const { relPath } = finishSession(stored.session, stored.interviewer, {
    root: deps.root,
    track: 'mock',
    startedAt: stored.startedAt,
  })
  if (stored.sseClient) {
    writeSSE(stored.sseClient, 'ended', { endedEarly: stored.session.endedEarly() ?? null, relPath })
    stored.sseClient.end()
  }
  store.remove(id)
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  const store = deps.store ?? createSessionStore()
  const now = deps.now ?? Date.now
  const transcode = deps.transcode ?? transcodeToWav

  const idleMs = deps.idleMs ?? 5 * 60_000
  const sweep = setInterval(() => {
    for (const stored of store.reapIdle(now(), idleMs)) {
      endAndPersist(deps, store, stored.id)
    }
  }, Math.min(idleMs, 30_000))
  sweep.unref()

  return createServer((req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res)
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      // `create()` stamps `lastActivity` with the real wall clock; put it on
      // the injected clock instead so the idle sweep (which reads via
      // `now()`) measures against the same timeline tests control.
      store.touch(stored.id, now())
      sendJson(res, 201, { id: stored.id })
      return
    }

    const streamMatch = /^\/api\/session\/([^/]+)\/stream$/.exec(url.pathname)
    if (req.method === 'GET' && streamMatch) {
      const id = streamMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      stored.sseClient = res

      req.on('close', () => {
        endAndPersist(deps, store, id)
      })

      const alreadyBegun = stored.session.entries().length > 0
      if (!alreadyBegun) {
        void (async () => {
          const before = stored.session.entries().length
          await streamTurn(res, stored.session.begin())
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(res, 'entry', entry)
          }
          if (stored.session.endedEarly()) endAndPersist(deps, store, id)
        })()
      }
      return
    }

    const turnMatch = /^\/api\/session\/([^/]+)\/turn$/.exec(url.pathname)
    if (req.method === 'POST' && turnMatch) {
      const id = turnMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      if (stored.session.endedEarly()) {
        sendJson(res, 409, { error: 'session already ended' })
        return
      }
      store.touch(id, now())

      // The moment the upload arrived is the moment Andre's turn actually
      // ended — sample it before transcode/transcription latency has a
      // chance to leak into the pacing analytics `submitTurn`/`reportFailure`
      // stamp entries with.
      const at = now()

      const chunks: Buffer[] = []
      let total = 0
      let tooLarge = false
      for await (const chunk of req) {
        const buf = chunk as Buffer
        total += buf.length
        if (total > MAX_TURN_AUDIO_BYTES) {
          tooLarge = true
          break
        }
        chunks.push(buf)
      }
      if (tooLarge) {
        sendJson(res, 413, { error: 'audio upload too large' })
        req.destroy()
        return
      }
      const audio = Buffer.concat(chunks)

      const inputPath = join(stored.scratchDir, `turn-${Date.now()}.webm`)
      const outputPath = join(stored.scratchDir, `turn-${Date.now()}.wav`)
      await writeFile(inputPath, audio)

      let text: string
      try {
        try {
          await transcode(inputPath, outputPath)
          text = (await deps.transcriber.transcribe(outputPath)).text
        } finally {
          // Never leave uploaded/transcoded audio behind, success or failure.
          await Promise.all([
            unlink(inputPath).catch(() => {}),
            unlink(outputPath).catch(() => {}),
          ])
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        stored.session.reportFailure(message, at)
        sendJson(res, 422, { error: message })
        endAndPersist(deps, store, id)
        return
      }

      sendJson(res, 202, { text })

      void (async () => {
        // `submitTurn` commits the Andre entry synchronously, before the
        // interviewer's reply streams — mirror that ordering on the wire so
        // the browser sees Andre's turn land before the reply's sentences.
        const iterable = stored.session.submitTurn(text, at)
        const before = stored.session.entries().length - 1
        if (stored.sseClient) {
          writeSSE(stored.sseClient, 'entry', stored.session.entries()[before])
        }
        await streamTurn(stored.sseClient!, iterable)
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before + 1)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, id)
      })()
      return
    }

    const endMatch = /^\/api\/session\/([^/]+)\/end$/.exec(url.pathname)
    if (req.method === 'POST' && endMatch) {
      const id = endMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      const { relPath, storyLogWritten } = finishSession(stored.session, stored.interviewer, {
        root: deps.root,
        track: 'mock',
        startedAt: stored.startedAt,
      })
      if (stored.sseClient) {
        writeSSE(stored.sseClient, 'ended', { endedEarly: stored.session.endedEarly() ?? null, relPath })
        stored.sseClient.end()
      }
      store.remove(id)
      sendJson(res, 200, { relPath, storyLogWritten })
      return
    }

    notFound(res)
  }
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
