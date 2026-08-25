import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore, type SessionStore } from './session-store'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * The 401 gate, and the reason `/api/auth/*` is mounted above everything.
 *
 * Tested with a stub identity rather than a real Better Auth instance, because
 * what is being pinned here is the *shape* of the chain — which requests are
 * gated, which are not, and whether the auth handler still sees an unread
 * request body. None of that is a question about cookies, and standing up an
 * auth server to ask it would make the test slower and vaguer at once.
 *
 * The Postgres file covers the other half: that a real anonymous session
 * actually isolates one person's work from another's.
 */

let server: Server | undefined
let root: string
let port: number
/**
 * One store behind both servers, which is how a deployed instance actually
 * works: one process, one `Map`, several people. Two stores would prove nothing
 * about isolation — of course two separate maps do not see each other.
 */
let sharedStore: SessionStore

function seed(): void {
  const write = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  write('problems/two-pointers/valid-palindrome/README.md', '# Valid Palindrome\n')
  write('problems/two-pointers/valid-palindrome/meta.yaml', 'difficulty: warmup\n')
  write('prompts/drill.md', 'DRILL')
  write('prompts/design.md', 'DESIGN')
}

/** What the auth handler saw, so a consumed body is visible rather than a hang. */
const seenByAuth: { path: string; body: string }[] = []

function stubAuth(userId: string | null): NonNullable<VoiceServerDeps['auth']> {
  return {
    handle: async (req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      seenByAuth.push({ path: req.url ?? '', body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, sawBody: body }))
    },
    resolveUserId: async () => userId,
  }
}

function listen(auth: VoiceServerDeps['auth'], extra: Partial<VoiceServerDeps> = {}): Promise<number> {
  server = createVoiceServer({
    root,
    createTransport: () =>
      async function* () {
        yield 'never reached'
      },
    transcriber: { transcribe: async () => ({ text: '' }) },
    auth,
    store: sharedStore,
    ...extra,
  })
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve(address.port)
    })
  })
}

beforeEach(() => {
  seenByAuth.length = 0
  sharedStore = createSessionStore()
  root = mkdtempSync(join(tmpdir(), 'voice-auth-gate-'))
  seed()
})

afterEach(() => {
  server?.close()
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`)

describe('local mode has no gate at all', () => {
  /**
   * The daily loop must keep working with no setup: no database, no cookie, no
   * environment. `deps.auth` absent is what that looks like from in here, and
   * every existing test in this repo exercises it by simply not passing one.
   */
  it('serves the API with no auth configured', async () => {
    port = await listen(undefined)
    const res = await get('/api/problems?track=coding')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('valid-palindrome')
  })
})

describe('deployed mode fails closed', () => {
  beforeEach(async () => {
    port = await listen(stubAuth(null))
  })

  /**
   * Every `/api/` route, not just the session ones. `/api/history` handing back
   * the wrong person's drill log is the same class of bug as a session leak and
   * a far quieter one, so the gate is drawn at the prefix rather than at a list
   * of routes somebody has to keep current.
   */
  it.each([
    '/api/problems?track=coding',
    '/api/problems/valid-palindrome?track=coding',
    '/api/coding/valid-palindrome/exercise',
    '/api/coding/valid-palindrome/solution',
    '/api/history',
    '/api/devices/output',
    '/api/devices/config',
    '/api/session/anything',
  ])('401s %s for an unauthenticated request', async (path) => {
    const res = await get(path)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  /**
   * The shell has to be able to load in order to sign in. A gate that also
   * blocked the static assets would be a login page nobody can reach.
   */
  it('leaves static assets open', async () => {
    const res = await get('/')
    expect(res.status).not.toBe(401)
  })

  /** And the auth routes themselves, or signing in would require being signed in. */
  it('leaves /api/auth open despite the /api/ prefix', async () => {
    const res = await get('/api/auth/get-session')
    expect(res.status).toBe(200)
  })
})

describe('deployed mode with somebody signed in', () => {
  it('serves the API once a session resolves', async () => {
    port = await listen(stubAuth('ada'))
    const res = await get('/api/problems?track=coding')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('valid-palindrome')
  })
})

describe('one session each, not one session between everyone', () => {
  /**
   * The one-session-at-a-time rule is per person on a deployed instance, and
   * that is the same rule it always was — "you cannot be in two interviews at
   * once". It read as process-wide only because there had only ever been one
   * candidate. Two people sharing one slot would mean the second person to open
   * the app is told a session is already in progress and offered the chance to
   * end somebody else's drill.
   */
  it('lets two people hold a session at the same time', async () => {
    port = await listen(stubAuth('ada'))
    const start = (path = '/api/session') =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track: 'coding', problem: 'valid-palindrome' }),
      })

    const first = await start()
    expect(first.status).toBe(201)

    // Ada again: still one each, so this is the 409 the rule exists to give.
    expect((await start()).status).toBe(409)

    // Grace, on the same server. Her slot is her own.
    server?.close()
    const graceServer = createVoiceServer({
      root,
      createTransport: () =>
        async function* () {
          yield 'never reached'
        },
      transcriber: { transcribe: async () => ({ text: '' }) },
      auth: stubAuth('grace'),
      store: sharedStore,
    })
    await new Promise<void>((resolve) => graceServer.listen(0, '127.0.0.1', () => resolve()))
    const address = graceServer.address()
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
    const graceRes = await fetch(`http://127.0.0.1:${address.port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coding', problem: 'valid-palindrome' }),
    })
    expect(graceRes.status).toBe(201)
    graceServer.close()
  })

  /**
   * A session id is a `randomUUID`, so reaching someone else's takes knowing it
   * rather than guessing. This is the belt to that brace — and a 404 rather than
   * a 403, because a 403 confirms the id names a real session.
   */
  it('hides one person’s session from another', async () => {
    port = await listen(stubAuth('ada'))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'coding', problem: 'valid-palindrome' }),
    })
    const { id } = (await created.json()) as { id: string }
    expect(await (await fetch(`http://127.0.0.1:${port}/api/session/${id}`)).status).toBe(200)

    server?.close()
    const graceServer = createVoiceServer({
      root,
      createTransport: () =>
        async function* () {
          yield 'never reached'
        },
      transcriber: { transcribe: async () => ({ text: '' }) },
      auth: stubAuth('grace'),
      store: sharedStore,
    })
    await new Promise<void>((resolve) => graceServer.listen(0, '127.0.0.1', () => resolve()))
    const address = graceServer.address()
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
    for (const path of [
      `/api/session/${id}`,
      `/api/session/${id}/stream`,
    ]) {
      const res = await fetch(`http://127.0.0.1:${address.port}${path}`)
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 404`)
    }
    graceServer.close()
  })
})

describe('the auth handler is mounted above everything', () => {
  /**
   * The reason for the ordering, made into a test.
   *
   * `readJsonBody` and the raw `for await (const chunk of req)` loop in `/turn`
   * consume the request stream, and a consumed stream cannot be read again —
   * Better Auth's sign-in would hang pending, with no error raised anywhere and
   * nothing in a log to explain it. Mounting `/api/auth/*` first is what makes
   * that impossible rather than merely unlikely, so this asserts the body
   * survives the trip.
   */
  it('hands the auth route a body nobody has already read', async () => {
    port = await listen(stubAuth(null))
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    expect(res.status).toBe(200)
    expect(seenByAuth).toEqual([{ path: '/api/auth/sign-in/anonymous', body: '{"hello":"world"}' }])
  })

  /** Above `serveStatic` too, so an asset path can never shadow an auth route. */
  it('runs before static file serving', async () => {
    port = await listen(stubAuth(null))
    await get('/api/auth/get-session')
    expect(seenByAuth.map((s) => s.path)).toEqual(['/api/auth/get-session'])
  })
})

/**
 * Probes answer without a session.
 *
 * The whole point of the gate above is that everything under `/api/` fails
 * closed. A kubelet carries no cookie, so a probe placed under `/api/` would
 * 401 — which Kubernetes reads as a failing container and answers by
 * restarting the pod, forever, on account of the rule that protects the drill
 * log. That is why `/healthz` and `/readyz` sit above the gate rather than
 * inside it, and this is the test that keeps them there.
 *
 * `stubAuth('user-1')` throughout, deliberately: the gate is *installed and
 * working* in every case below, and the probes answer anyway. Passing no auth
 * at all would prove nothing, because then there would be no gate to be
 * outside of.
 */
describe('health probes are outside the auth gate', () => {
  it('answers /healthz through an installed auth gate, with no cookie', async () => {
    const port = await listen(stubAuth('user-1'))
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('answers /readyz through an installed auth gate, with no cookie', async () => {
    const port = await listen(stubAuth('user-1'), {
      ready: async () => ({ ready: true, detail: '42 problems, database answering' }),
    })
    const res = await fetch(`http://127.0.0.1:${port}/readyz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ready: true, detail: '42 problems, database answering' })
  })

  // The state a socket check cannot see: database up, schema applied, and no
  // problems — every request answers and every coding drill 404s.
  it('reports 503 when the server says it cannot serve a drill', async () => {
    const port = await listen(stubAuth('user-1'), {
      ready: async () => ({ ready: false, detail: 'no coding problems loaded' }),
    })
    const res = await fetch(`http://127.0.0.1:${port}/readyz`)
    expect(res.status).toBe(503)
    expect(((await res.json()) as { detail: string }).detail).toContain('no coding problems')
  })

  // A dead pool throws rather than returning false. Reported, not swallowed:
  // the message is the only thing separating "Postgres is still starting" from
  // "the schema never applied".
  it('turns a throwing readiness check into a 503 that says why', async () => {
    const port = await listen(stubAuth('user-1'), {
      ready: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      },
    })
    const res = await fetch(`http://127.0.0.1:${port}/readyz`)
    expect(res.status).toBe(503)
    expect(((await res.json()) as { detail: string }).detail).toContain('ECONNREFUSED')
  })

  // Local mode has no database to wait on and no cache to warm.
  it('is ready by default when no check is installed', async () => {
    const port = await listen(stubAuth('user-1'))
    const res = await fetch(`http://127.0.0.1:${port}/readyz`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ready: boolean }).ready).toBe(true)
  })
})
