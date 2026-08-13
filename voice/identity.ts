import { timingSafeEqual } from 'node:crypto'
import { isSafeUserId } from './user-root'

/**
 * Who a deployed request is acting as, from Authentik's forward-auth headers.
 *
 * `mode` is a check, not a fallback: a local instance never reads these
 * headers at all, forged or not. If local mode fell through to "trust the
 * header when present," any process on the machine that can set a header —
 * curl, a browser extension, a misbehaving tool — would authenticate as
 * whoever Authentik would have named, on a machine that never asked
 * Authentik anything. Missing or blank identity is a 401 for the caller to
 * raise, never a default user; silently picking one hands a bare request
 * someone else's drill log.
 */
export function deriveUserId(
  req: { headers: NodeJS.Dict<string | string[]> },
  deps: { mode: 'local' | 'deployed'; gatewaySecret?: string },
): string | null {
  if (deps.mode !== 'deployed') return null

  if (deps.gatewaySecret !== undefined) {
    const got = req.headers['x-gateway-secret']
    if (typeof got !== 'string' || !secretsMatch(got, deps.gatewaySecret)) return null
  }

  const raw = req.headers['x-authentik-uid']
  // Traefik/Authentik never repeat this header, so an array here means a
  // client set it directly and forwardAuth appended rather than replaced —
  // treat that as tampering, not as a uid with extra values to sift through.
  if (typeof raw !== 'string') return null
  const uid = raw.trim()
  if (uid === '') return null
  // Shape is checked here, at the boundary, not left to `userDataDir`. Both
  // refuse the same ids, but reaching the throw means the request already
  // counted as authenticated, so a traversal attempt would surface as a 500
  // instead of the 401 that a request carrying no usable identity deserves.
  return isSafeUserId(uid) ? uid : null
}

// `!==` on secrets leaks their length and, byte by byte, their value through
// timing — the whole reason this check exists is to be a real backstop, not
// a comparison an attacker can budget around.
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
