/**
 * Make sure this browser has an identity before the app asks the API anything.
 *
 * On a deployed instance every `/api/` route fails closed, and the landing
 * screen fetches `/api/problems` and `/api/history` the moment it renders. So
 * this runs before React mounts at all. The two alternatives were both worse: a
 * second, weaker unauthenticated path for those two routes reintroduces exactly
 * the two-tier trust surface the fail-closed rule exists to remove, and
 * deferring to "first action" gives a picker that 401s until you click
 * something, which reads as the app being down.
 *
 * Deliberately outside React. It happens once per page load, not once per mount,
 * and `StrictMode` mounts twice in development — a `useEffect` here would sign
 * in twice and mint two anonymous users on the first visit of every developer.
 *
 * **Local mode has no auth at all**, and that is not an error condition. There
 * is no `/api/auth/*` route, the probe 404s, and this returns `local` and gets
 * out of the way. Nothing about a local drill should require a round trip to
 * decide whether it is allowed to start.
 */

export type BootOutcome =
  | 'local'
  | 'existing'
  | 'signed-in-anonymously'
  | 'unavailable'

interface SessionBody {
  user?: { id?: string } | null
}

/**
 * `fetch`, injected so this can be tested without a browser or a server.
 */
export async function ensureSession(fetchImpl: typeof fetch = fetch): Promise<BootOutcome> {
  let probe: Response
  try {
    probe = await fetchImpl('/api/auth/get-session', { headers: { accept: 'application/json' } })
  } catch {
    // The network is down, or the server is not up yet. Not something to
    // resolve here: the app's own error banners are better at saying so than a
    // blank screen would be, and every route is about to fail in a way the user
    // can actually see.
    return 'unavailable'
  }

  // No auth routes at all — this is a local run. Any 404 means the same thing:
  // nothing is mounted at `/api/auth/`, so nothing is gating anything.
  if (probe.status === 404) return 'local'
  if (!probe.ok) return 'unavailable'

  let body: SessionBody | null = null
  try {
    body = (await probe.json()) as SessionBody | null
  } catch {
    body = null
  }
  if (body?.user?.id) return 'existing'

  // No session yet. Anonymous, and with no fingerprint: a cookie holds your work
  // on this browser, and registering makes it follow you. That sentence is one
  // the app can put on screen honestly, which is the whole reason this is a
  // cookie and not a device signature.
  const created = await fetchImpl('/api/auth/sign-in/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null)

  return created?.ok ? 'signed-in-anonymously' : 'unavailable'
}
