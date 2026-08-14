import {
  DEMO_BY_DIFFICULTY,
  DEMO_HISTORY_ROWS,
  DEMO_PROBLEMS,
  DEMO_ROADMAP,
  DEMO_RUST,
  DEMO_SUMMARY,
} from './fixtures'

/**
 * The demo instance's whole backend.
 *
 * There is no server. `pnpm build:web:demo` produces static files, this
 * intercepts the `/api/*` calls the screens make, and the result can be hosted
 * anywhere that serves a directory. That is deliberate: a demo with no backend
 * has no `local/` to leak, no session to hijack and no identity to forge, so
 * the entire class of "is the read-only flag really read-only" question does
 * not arise.
 *
 * Anything not answered here is refused rather than passed through. A demo
 * that quietly forwarded an unknown route to a real origin would be exactly
 * the leak this build exists to make impossible.
 */

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

/** Routes that only make sense with a live session, and are simply absent here. */
const NOT_IN_DEMO = new Response(JSON.stringify({ error: 'not available in the demo' }), {
  status: 501,
  headers: { 'content-type': 'application/json' },
})

export function demoResponse(pathname: string, search: string): Response | null {
  if (pathname === '/api/instance') return json({ mode: 'local' })

  if (pathname === '/api/problems/coding/detail') return json({ problems: DEMO_PROBLEMS })

  if (pathname === '/api/history') {
    // The same wire-level gate the real route has. Reproduced rather than
    // simplified away: a visitor poking at the demo should find the tool
    // behaving the way it actually behaves.
    const wantsPatterns = new URLSearchParams(search).get('patterns') === '1'
    return json({
      summary: DEMO_SUMMARY,
      rows: DEMO_HISTORY_ROWS.map((row) => (wantsPatterns ? row : { ...row, pattern: undefined })),
      coached: [],
    })
  }

  if (pathname === '/api/progress') return json({ summary: DEMO_SUMMARY, byDifficulty: DEMO_BY_DIFFICULTY })

  if (pathname === '/api/roadmap') {
    if (new URLSearchParams(search).get('study') !== '1') {
      return new Response(JSON.stringify({ error: 'study mode not requested' }), { status: 400 })
    }
    return json({ patterns: DEMO_ROADMAP })
  }

  if (pathname === '/api/rust') return json(DEMO_RUST)

  // The worked answers are not in this build at all. Not gated, not hidden —
  // absent. `solutions/**` is the answer key to every problem in the repo, and
  // a public demo has no business shipping it under any flag.
  if (pathname.startsWith('/api/review/')) return NOT_IN_DEMO

  if (pathname.startsWith('/api/')) return NOT_IN_DEMO

  return null
}

/**
 * Patch `fetch` for `/api/*`. Everything else — the page's own assets — is
 * left alone.
 */
export function installDemoApi(): void {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const answer = demoResponse(url.pathname, url.search)
    return answer ?? real(input as RequestInfo, init)
  }) as typeof fetch
}
