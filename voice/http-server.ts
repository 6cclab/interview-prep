import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './context'
import { createInterviewer, anthropicStream, type StreamFn } from './interviewer'
import { claudeCliStream } from './claude-cli'
import { createSession, finishSession } from './session'
import { createSessionStore, type SessionStore } from './session-store'
import { whisperTranscriber, type Transcriber } from './speech'
import { transcodeToWav } from './transcode'
import { readStaticFile, resolveStaticFile } from './static'

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
  /**
   * Directory the built React client is served from (Vite's `build.outDir`).
   * Defaults to `<root>/voice/dist`. Overridable so tests can point at a
   * small fixture directory instead of depending on a real `vite build`.
   */
  distDir?: string
}

// A recorded interview turn is at most a few minutes of audio; 25MB is a wide
// margin over that even at a generous bitrate. Reading an unbounded body
// straight into memory is a trivial way for a single request to exhaust it.
const MAX_TURN_AUDIO_BYTES = 25 * 1024 * 1024

function serveStatic(distDir: string, pathname: string, res: ServerResponse): boolean {
  const resolved = resolveStaticFile(distDir, pathname)
  if (!resolved) return false
  res.writeHead(200, { 'content-type': resolved.contentType })
  res.end(readStaticFile(resolved))
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

// `res` is optional: a turn can be submitted with no live SSE connection (the
// browser tab closed, or never reconnected), and the reply must still be
// drained to completion so the session's entries/endedEarly state advances —
// there is simply nowhere to write the sentence events.
async function streamTurn(res: ServerResponse | undefined, turn: AsyncIterable<string>): Promise<void> {
  for await (const sentence of turn) {
    if (res) writeSSE(res, 'sentence', { speaker: 'interviewer', text: sentence })
  }
}

function endAndPersist(
  deps: VoiceServerDeps,
  store: SessionStore,
  entryClocks: Map<string, () => number>,
  id: string,
): void {
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
  entryClocks.delete(id)
  // Every session's scratch directory is created in POST /api/session and
  // must not outlive the session — per-turn files are already unlinked as
  // they're consumed, but the directory itself was never removed on any exit
  // path until now.
  rmSync(stored.scratchDir, { recursive: true, force: true })
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  // Two different clocks, deliberately not the same function:
  //
  // `idleClock` is cross-session bookkeeping (lastActivity/reapIdle). It only
  // ever needs internal consistency — every read compares two values it
  // itself produced — so a plain wall clock is correct and has no zero-point
  // to get wrong.
  //
  // `Entry.at` is different: it's elapsed milliseconds *since that session
  // started*, not wall time — `transcript.ts` renders it as `[mm:ss]` and the
  // drill grades pacing off it. `cli.ts` gets this right by capturing
  // `started = Date.now()` once and subtracting, but that only works there
  // because a CLI process is one-shot: process start and session start are
  // the same instant. This server is long-running and can serve many
  // sessions back to back, so a single `Date.now() - <server start>` default
  // shared across all of them would give the second session's first entry an
  // `at` equal to however long the server had already been up — the same
  // class of bug as stamping raw epoch, just with a smaller, sneakier offset.
  // Each session's default clock must therefore be created fresh, at that
  // session's own start.
  const idleClock = deps.now ?? Date.now
  const store = deps.store ?? createSessionStore(undefined, idleClock)
  const transcode = deps.transcode ?? transcodeToWav
  const distDir = deps.distDir ?? join(deps.root, 'voice/dist')
  // Sessions whose POST /turn is still being processed (transcode/transcribe/
  // reply-stream in flight) — guards against a second /turn for the same
  // session landing before the first has finished.
  const turnsInFlight = new Set<string>()
  // Per-session elapsed clock for `Entry.at`, keyed by session id. When a
  // caller injects `deps.now` (every test in this repo), all sessions share
  // that one clock, same as before. When nothing is injected (production),
  // each session gets its own clock zeroed at that session's creation.
  const entryClocks = new Map<string, () => number>()

  function makeEntryClock(): () => number {
    if (deps.now) return deps.now
    const start = Date.now()
    return () => Date.now() - start
  }

  const idleMs = deps.idleMs ?? 5 * 60_000
  const sweep = setInterval(() => {
    for (const stored of store.reapIdle(idleClock(), idleMs)) {
      endAndPersist(deps, store, entryClocks, stored.id)
    }
  }, Math.min(idleMs, 30_000))
  sweep.unref()

  return createServer((req: IncomingMessage, res: ServerResponse): void => {
    // Opt-in request log, for diagnosing a browser we cannot see. Off unless
    // VOICE_DEBUG is set, so default behaviour and the test suite are
    // untouched. Logs method, path and response status only — never a body,
    // because a turn body is captured audio and a response could carry
    // transcribed speech.
    if (process.env.VOICE_DEBUG) {
      const started = Date.now()
      res.once('finish', () => {
        console.error(`[req] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`)
      })
    }
    void handleRequest(req, res)
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(distDir, url.pathname, res)) return

    // Recovery path for a 409 from POST /api/session below: the browser has
    // no id for whatever session is stuck (the 409 body never carried one),
    // so this ends whichever session the store currently considers active
    // instead of requiring one. There is at most one, per `hasActive`'s
    // invariant.
    if (req.method === 'DELETE' && url.pathname === '/api/session') {
      const id = store.activeId()
      if (!id) {
        sendJson(res, 404, { error: 'no active session' })
        return
      }
      endAndPersist(deps, store, entryClocks, id)
      sendJson(res, 200, { ended: true })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      // Deliberately does not read the request body: the design track is out
      // of scope, so there is no client-supplied `track` or `problem` for
      // this boundary to validate. If `/design` is ever added here,
      // `context.ts`'s `PROBLEM_SLUG` and `assertNoSpoilers` must run on
      // whatever arrives in the body before it reaches `buildSystemPrompt`.
      if (store.hasActive()) {
        sendJson(res, 409, { error: 'a session is already in progress' })
        return
      }
      const system = buildSystemPrompt(deps.root, 'mock')
      const interviewer = createInterviewer(system, deps.createTransport())
      const entryClock = makeEntryClock()
      const session = createSession({ interviewer, now: () => entryClock() })
      const scratchDir = mkdtempSync(join(tmpdir(), 'voice-web-'))
      const stored = store.create(session, interviewer, new Date(), scratchDir)
      entryClocks.set(stored.id, entryClock)
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

      if (stored.sseClient) {
        // A reconnect: the previous response has no reader left on the other
        // end, and a turn already in flight could still write to it. End it
        // explicitly rather than leaving it open until its own socket happens
        // to close — that would let the stale response linger indefinitely
        // and race the new one for writes. Ending it here (rather than
        // refusing the new connection) is what lets `EventSource`'s built-in
        // auto-reconnect actually recover a dropped connection.
        stored.sseClient.end()
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      // `writeHead` only queues the status line and headers — Node doesn't
      // actually put them on the wire until the first `write()`/`end()`, per
      // its own docs. A reconnect that lands after the opening turn has
      // already streamed (the common case: the drill has been running for a
      // while) writes nothing else until the next real event, so without an
      // explicit flush here the new connection's headers would sit buffered
      // indefinitely and the client would hang waiting for a response that
      // was, from Node's perspective, already "sent".
      res.flushHeaders()
      stored.sseClient = res

      req.on('close', () => {
        // This handler is registered once per connection, but a reconnect
        // (above) proactively ends the *previous* response, which fires
        // *that* response's own already-registered 'close' handler. By the
        // time it fires, `stored.sseClient` has already been reassigned to
        // the new connection's response — so only tear down the session if
        // this handler's own `res` is still the current client. Otherwise a
        // stale handler from an ended, superseded response would run
        // `endAndPersist` and kill the session (and the brand-new
        // connection) out from under a live reconnect.
        if (store.get(id)?.sseClient !== res) return
        endAndPersist(deps, store, entryClocks, id)
      })

      const alreadyBegun = stored.session.entries().length > 0
      if (!alreadyBegun) {
        void (async () => {
          const before = stored.session.entries().length
          await streamTurn(res, stored.session.begin())
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(res, 'entry', entry)
          }
          if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, id)
        })().catch((error: unknown) => {
          console.error('voice session opening turn failed:', error)
        })
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
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      turnsInFlight.add(id)
      store.touch(id, idleClock())

      // The moment the upload arrived is the moment Andre's turn actually
      // ended — sample it before transcode/transcription latency has a
      // chance to leak into the pacing analytics `submitTurn`/`reportFailure`
      // stamp entries with. Uses this session's own entry clock, not the
      // idle-bookkeeping one — see the comment above `entryClocks`.
      const entryClock = entryClocks.get(id)!
      const at = entryClock()

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
        turnsInFlight.delete(id)
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
        turnsInFlight.delete(id)
        const message = error instanceof Error ? error.message : String(error)
        stored.session.reportFailure(message, at)
        sendJson(res, 422, { error: message })
        endAndPersist(deps, store, entryClocks, id)
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
        // No live SSE connection is a normal state (a turn submitted between
        // reconnects, say), not a reason to stop draining the reply — the
        // session's entries/endedEarly state must still advance either way.
        await streamTurn(stored.sseClient, iterable)
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before + 1)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, id)
      })()
        .catch((error: unknown) => {
          console.error('voice session turn failed:', error)
        })
        .finally(() => {
          turnsInFlight.delete(id)
        })
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
      entryClocks.delete(id)
      rmSync(stored.scratchDir, { recursive: true, force: true })
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

const WHISPER_BINARY = process.env.WHISPER_BINARY ?? 'whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'models/ggml-large-v3-turbo.bin'

function chooseTransport(): StreamFn {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Transport: Anthropic Messages API (spending Console credits)')
    return anthropicStream(new Anthropic())
  }
  console.log('Transport: claude CLI (spending Claude subscription quota)')
  return claudeCliStream()
}

function main(): void {
  const port = process.env.PORT ? Number(process.env.PORT) : 4173
  const root = process.cwd()
  const distDir = join(root, 'voice/dist')
  // `pnpm mock:web` builds before it starts this process (see package.json),
  // so a missing dist here means the server was started some other way
  // (directly via `tsx voice/http-server.ts`) without building first — fail
  // with a clear instruction rather than a confusing string of 404s on every
  // asset the page tries to load.
  if (!existsSync(distDir)) {
    console.error(
      `Missing ${distDir} — build the web client first with \`pnpm build:web\`, ` +
        'or just run `pnpm mock:web`, which does that for you.',
    )
    process.exit(1)
  }
  const server = createVoiceServer({
    root,
    createTransport: chooseTransport,
    transcriber: whisperTranscriber({ binary: WHISPER_BINARY, model: WHISPER_MODEL }),
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`Voice mock drill: http://127.0.0.1:${port}/`)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
