/**
 * Traefik and the Authentik outpost, for a laptop.
 *
 * A deployed-mode container refuses every `/api/` request without an identity
 * header, which is the point — `deriveUserId` fails closed. A browser pointed
 * straight at the published port therefore shows every track as "Unavailable".
 * This puts in front of it the same thing the cluster does, so the image can be
 * clicked through before it is deployed.
 *
 * Not a flag on the server. An env var that made the server accept an identity
 * it was never given is an auth bypass one misconfiguration away from
 * production; a proxy that only exists on a laptop cannot be deployed by
 * accident.
 *
 * **Local drills do not need this.** `pnpm mock:web` is unchanged and always
 * will be: `VOICE_MODE` defaults to local, which reads no headers at all.
 */
import { createServer, request, type IncomingHttpHeaders } from 'node:http'

const IDENTITY = /^x-authentik-/i

/**
 * The middleware chain from `deploy/k8s.yaml`, in the order that makes it a
 * security property rather than a formality: CLEAR what the client sent, THEN
 * set the uid, THEN stamp the gateway secret.
 *
 * Clearing first is the whole thing. `forwardAuth` does not strip a
 * client-supplied header of the same name before the outpost repopulates it,
 * so a chain that only sets lets a caller present their own uid and keep it.
 * Reproduced here so the local edge is never more permissive than the real one.
 */
export function edgeHeaders(
  incoming: IncomingHttpHeaders,
  opts: { uid: string; secret?: string; host: string },
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (IDENTITY.test(name) || name.toLowerCase() === 'x-gateway-secret') continue
    headers[name] = value
  }
  headers['x-authentik-uid'] = opts.uid
  if (opts.secret !== undefined && opts.secret !== '') headers['x-gateway-secret'] = opts.secret
  headers.host = opts.host
  return headers
}

/**
 * Say out loud whether identity is actually being accepted.
 *
 * Both ways this goes wrong look identical from a browser — a plain 401 — and
 * neither names itself: pointing at the container's own port instead of this
 * one, or a `VOICE_GATEWAY_SECRET` set on the container but not in the shell
 * that started the edge. One request at startup turns both into a sentence.
 */
async function reportIdentity(upstream: number, uid: string, secret: string | undefined): Promise<void> {
  const headers = edgeHeaders({}, { uid, secret, host: `127.0.0.1:${upstream}` }) as Record<string, string>
  let status: number
  try {
    status = (await fetch(`http://127.0.0.1:${upstream}/api/instance`, { headers })).status
  } catch {
    console.log(`  No container answering on ${upstream}. Start it with \`pnpm deploy:run\`.`)
    return
  }
  if (status === 200) {
    console.log(`  Upstream accepts this identity. Open the URL above, not ${upstream}.`)
  } else if (status === 401) {
    console.log(
      `  Upstream returned 401 for this identity. The container has a VOICE_GATEWAY_SECRET this edge ` +
        'does not — export the same value in this shell.',
    )
  } else {
    console.log(`  Upstream answered ${status} to /api/instance, which is neither expected outcome.`)
  }
}

export function startEdge(): void {
  const port = Number(process.env.EDGE_PORT ?? 4200)
  const upstream = Number(process.env.EDGE_UPSTREAM ?? 4199)
  const uid = process.env.EDGE_UID ?? 'ak-local'
  const secret = process.env.VOICE_GATEWAY_SECRET

  createServer((req, res) => {
    const headers = edgeHeaders(req.headers, { uid, secret, host: `127.0.0.1:${upstream}` })
    const proxied = request({ host: '127.0.0.1', port: upstream, path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    proxied.on('error', (err: Error) => {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(`No container on ${upstream}: ${err.message}\n`)
    })
    req.pipe(proxied)
    // 127.0.0.1 only. This forges an identity by design, and has no business
    // being reachable from anywhere but the machine running it.
  })
    .on('error', (err: NodeJS.ErrnoException) => {
      // Overwhelmingly an edge left running by a previous attempt. Unhandled,
      // this is a stack trace about `listen`, which buries the one useful fact.
      if (err.code === 'EADDRINUSE') {
        console.error(`\n  Something already holds ${port} — most likely an edge from an earlier run.`)
        console.error(`  Stop it with \`pkill -f deploy-edge\`, or set EDGE_PORT to a free port.`)
        process.exit(1)
      }
      throw err
    })
    .listen(port, '127.0.0.1', () => {
    console.log(`\n  Open http://127.0.0.1:${port}  — signed in as ${uid}.`)
    void reportIdentity(upstream, uid, secret)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) startEdge()
