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
let ids = 0

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('prompts/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')

  // The coach track needs a real problem, and the allowlist test is only
  // honest if the allowed user gets all the way to a 201 — see `coachPaths`
  // for why every one of these has to exist. They are the answer key the
  // allowlist is guarding, which is the whole point of seeding them here.
  seed('prompts/coach.md', 'COACH COMMAND')
  seed('patterns.md', '| pattern | tell | insight | example |\n')
  seed('problems/two-pointers/two-sum-sorted/README.md', '# Two sum\n\nFind two numbers.\n')
  seed('problems/two-pointers/two-sum-sorted/solution.test.ts', 'SUITE')
  seed('problems/two-pointers/two-sum-sorted/meta.yaml', 'pattern: two-pointers\ntitle: Two sum\ndifficulty: easy\n')
  seed('problems/two-pointers/two-sum-sorted/solution.ts', 'export function twoSum() {}\n')
  seed('solutions/two-pointers/two-sum-sorted.md', 'WORKED-ANSWER-SPOILER')
}

function deps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = (): number => 0
  return {
    root,
    createTransport: () => async function* () {
      yield 'Ready when you are.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => `session-${++ids}`, now),
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

const startSession = (port: number, headers: Record<string, string> = {}, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
  })

beforeEach(() => {
  ids = 0
  root = mkdtempSync(join(tmpdir(), 'deployed-mode-'))
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

describe('local mode is unchanged', () => {
  it('starts a session with no identity at all, as it does today', async () => {
    const { port } = await listen(deps())
    expect((await startSession(port)).status).toBe(201)
  })

  // The whole reason `deriveUserId` checks mode instead of header presence.
  it('ignores a forged identity header rather than acting on it', async () => {
    const { port } = await listen(deps())
    const res = await startSession(port, { 'x-authentik-uid': 'attacker' })
    expect(res.status).toBe(201)
  })
})

// The client has to know which instance it is talking to, because the two run
// the suite in different places. It cannot infer it: a deployed instance with
// no identity looks exactly like a broken local one from the browser's side.
describe('GET /api/instance', () => {
  it('says local when nothing says otherwise', async () => {
    const { port } = await listen(deps())
    const res = await fetch(`http://127.0.0.1:${port}/api/instance`)
    expect(await res.json()).toEqual({ mode: 'local' })
  })

  it('says deployed on a deployed instance', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await fetch(`http://127.0.0.1:${port}/api/instance`, { headers: { 'x-authentik-uid': 'ak-alice' } })
    expect(await res.json()).toEqual({ mode: 'deployed' })
  })

  // It is behind the same gate as everything else under /api/. The mode is not
  // a secret, but an exception here would be a hole to remember forever.
  it('is gated like every other api route', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    expect((await fetch(`http://127.0.0.1:${port}/api/instance`)).status).toBe(401)
  })
})

describe('deployed mode requires an identity', () => {
  it('refuses an api request carrying no identity', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await startSession(port)
    expect(res.status).toBe(401)
  })

  it('serves a request Authentik has named', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await startSession(port, { 'x-authentik-uid': 'ak-alice' })
    expect(res.status).toBe(201)
  })

  // A traversal in the header is a request with no usable identity, so it is
  // the same 401 — not the 500 that reaching `userDataDir`'s throw would give.
  it('refuses an identity that could not name a directory', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    const res = await startSession(port, { 'x-authentik-uid': '../alice' })
    expect(res.status).toBe(401)
  })
})

describe('one session at a time, per person', () => {
  it('does not let one person\'s drill lock everyone else out', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    expect((await startSession(port, { 'x-authentik-uid': 'ak-alice' })).status).toBe(201)
    expect((await startSession(port, { 'x-authentik-uid': 'ak-bob' })).status).toBe(201)
  })

  it('still allows each person only one, and names theirs to recover', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true }))
    await startSession(port, { 'x-authentik-uid': 'ak-alice' })
    await startSession(port, { 'x-authentik-uid': 'ak-bob' })
    const res = await startSession(port, { 'x-authentik-uid': 'ak-alice' })
    expect(res.status).toBe(409)
    // Alice's own session, not whichever the store happened to hold first —
    // a 409 that hands back someone else's id invites her to end their drill.
    expect(((await res.json()) as { id: string }).id).toBe('session-1')
  })
})

describe('the coach track on a shared instance', () => {
  // `coachPaths` deliberately serves solutions/** and patterns.md. That is a
  // choice you make about your own drilling; behind a URL other people can
  // reach it is an answer key. Gated by an allowlist rather than by weakening
  // the door, per coach.ts's own "a separate door, not the drill door with
  // the lock off".
  it('refuses the answer-key track to someone not on the allowlist', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true, coachAllowlist: new Set(['ak-owner']) }))
    const res = await startSession(port, { 'x-authentik-uid': 'ak-alice' }, { track: 'coach', problem: 'two-sum-sorted' })
    expect(res.status).toBe(403)
  })

  it('does not gate the owner out of his own instance', async () => {
    const { port } = await listen(deps({ mode: 'deployed', multiUser: true, coachAllowlist: new Set(['ak-owner']) }))
    const res = await startSession(port, { 'x-authentik-uid': 'ak-owner' }, { track: 'coach', problem: 'two-sum-sorted' })
    // A concrete status, not `not.toBe(403)`: that would also pass on a 400 or
    // a 500, so it would keep passing if the allowlist let nobody through.
    expect(res.status).toBe(201)
  })

  it('leaves the local instance ungated, where the choice is yours to make', async () => {
    const { port } = await listen(deps())
    const res = await startSession(port, {}, { track: 'coach', problem: 'two-sum-sorted' })
    expect(res.status).toBe(201)
  })
})
