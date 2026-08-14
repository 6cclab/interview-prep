import { describe, expect, it } from 'vitest'
import { edgeHeaders } from './deploy-edge'

const opts = { uid: 'ak-local', host: '127.0.0.1:4199' }

describe('edgeHeaders', () => {
  it('signs the request in as the chosen uid', () => {
    expect(edgeHeaders({}, opts)['x-authentik-uid']).toBe('ak-local')
  })

  /**
   * The one that matters. A chain that only sets, without clearing first, lets
   * a caller present their own uid and keep it — the forgeable-identity bug
   * `deploy/k8s.yaml` orders its middlewares to avoid.
   */
  it('drops an identity the caller tried to supply', () => {
    const headers = edgeHeaders({ 'x-authentik-uid': 'someone-else', 'x-authentik-groups': 'admins' }, opts)
    expect(headers['x-authentik-uid']).toBe('ak-local')
    expect(headers['x-authentik-groups']).toBeUndefined()
  })

  // Same reasoning: the secret is the edge's to set, never the caller's.
  it('drops a gateway secret the caller tried to supply', () => {
    expect(edgeHeaders({ 'x-gateway-secret': 'guessed' }, opts)['x-gateway-secret']).toBeUndefined()
  })

  it('stamps the gateway secret when it has one', () => {
    expect(edgeHeaders({}, { ...opts, secret: 's3cret' })['x-gateway-secret']).toBe('s3cret')
  })

  // An empty string is what an unset shell variable expands to, and `Bearer `
  // style empty values are worse than absent ones.
  it('treats an empty secret as no secret', () => {
    expect(edgeHeaders({}, { ...opts, secret: '' })['x-gateway-secret']).toBeUndefined()
  })

  it('leaves everything else alone', () => {
    expect(edgeHeaders({ accept: 'text/html', cookie: 'a=b' }, opts)).toMatchObject({
      accept: 'text/html',
      cookie: 'a=b',
    })
  })

  // Otherwise the upstream sees the edge's own port in Host.
  it('rewrites Host to the upstream', () => {
    expect(edgeHeaders({ host: '127.0.0.1:4200' }, opts).host).toBe('127.0.0.1:4199')
  })
})
