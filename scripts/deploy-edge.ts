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

function main(): void {
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
  }).listen(port, '127.0.0.1', () => {
    console.log(`Edge on http://127.0.0.1:${port} -> container on ${upstream}, signed in as ${uid}.`)
    console.log('EDGE_UID to be someone else, EDGE_UPSTREAM to point elsewhere.')
  })
}

if (import.meta.url === `file://${process.argv[1]}`) main()
