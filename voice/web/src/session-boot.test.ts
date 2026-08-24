import { describe, expect, it } from 'vitest'
import { ensureSession } from './session-boot'

/**
 * What the app does about identity before it renders.
 *
 * The cases that matter are the two ends: a local run, where there is no auth
 * and asking for one must not slow anything down or fail anything; and a
 * deployed one, where every `/api/` route is closed until a cookie exists.
 */

interface Call {
  url: string
  method: string
}

function stub(
  responses: Record<string, { status: number; body?: unknown } | 'throw'>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const planned = responses[url]
    if (planned === undefined) throw new Error(`unexpected fetch: ${url}`)
    if (planned === 'throw') throw new Error('network down')
    return new Response(planned.body === undefined ? null : JSON.stringify(planned.body), {
      status: planned.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

describe('a local run', () => {
  /**
   * There is no `/api/auth/*` route in local mode, so the probe 404s. That is
   * the expected shape of a local run and not an error — and nothing further is
   * attempted, because signing in against a server with no auth would just be a
   * second 404 and a slower boot.
   */
  it('recognises the absent auth routes and stops there', async () => {
    const { fetch, calls } = stub({ '/api/auth/get-session': { status: 404 } })
    expect(await ensureSession(fetch)).toBe('local')
    expect(calls).toEqual([{ url: '/api/auth/get-session', method: 'GET' }])
  })
})

describe('a deployed instance', () => {
  it('signs in anonymously when there is no session yet', async () => {
    const { fetch, calls } = stub({
      '/api/auth/get-session': { status: 200, body: null },
      '/api/auth/sign-in/anonymous': { status: 200, body: { token: 't' } },
    })
    expect(await ensureSession(fetch)).toBe('signed-in-anonymously')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/auth/get-session',
      'POST /api/auth/sign-in/anonymous',
    ])
  })

  /**
   * A returning visitor must not be signed in again. A second anonymous user
   * would silently orphan every drill the first one did — the work would still
   * exist, on a row this browser no longer presents a cookie for.
   */
  it('leaves an existing session alone', async () => {
    const { fetch, calls } = stub({
      '/api/auth/get-session': { status: 200, body: { user: { id: 'ada' } } },
    })
    expect(await ensureSession(fetch)).toBe('existing')
    expect(calls).toHaveLength(1)
  })

  it('treats a session body with no user as no session', async () => {
    const { fetch } = stub({
      '/api/auth/get-session': { status: 200, body: { user: null } },
      '/api/auth/sign-in/anonymous': { status: 200, body: {} },
    })
    expect(await ensureSession(fetch)).toBe('signed-in-anonymously')
  })
})

describe('when the server cannot answer', () => {
  /**
   * Never a throw. `main.tsx` awaits this before rendering, so a rejection here
   * is a blank page with a console message — strictly worse than the app's own
   * error banners, which are built to say what is wrong.
   */
  it('reports unavailable rather than rejecting, on a dead network', async () => {
    const { fetch } = stub({ '/api/auth/get-session': 'throw' })
    await expect(ensureSession(fetch)).resolves.toBe('unavailable')
  })

  it('reports unavailable on a 500', async () => {
    const { fetch } = stub({ '/api/auth/get-session': { status: 500 } })
    await expect(ensureSession(fetch)).resolves.toBe('unavailable')
  })

  it('reports unavailable when the sign-in itself fails', async () => {
    const { fetch } = stub({
      '/api/auth/get-session': { status: 200, body: null },
      '/api/auth/sign-in/anonymous': { status: 500 },
    })
    await expect(ensureSession(fetch)).resolves.toBe('unavailable')
  })

  it('survives a body that is not JSON', async () => {
    const impl = (async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch
    await expect(ensureSession(impl)).resolves.toBe('signed-in-anonymously')
  })
})
