import { describe, it, expect } from 'vitest'
import { deriveUserId } from './identity'

function req(headers: NodeJS.Dict<string | string[]>): { headers: NodeJS.Dict<string | string[]> } {
  return { headers }
}

describe('deriveUserId', () => {
  // The single most important test in the file. A forged header from another
  // tool on the same machine must never authenticate anyone locally — mode is
  // the gate, not header presence, so local must not even look.
  it('ignores a forged uid header in local mode and returns null', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': 'attacker' }), { mode: 'local' }),
    ).toBeNull()
  })

  // This function is the trust boundary, so an id that cannot name a directory
  // has to die here. `userDataDir` does throw on one, but reaching it means the
  // request already passed for authenticated and the throw surfaces as a 500 —
  // an internal error for what is simply a request carrying no usable identity.
  // Rejecting here makes it the 401 it always was.
  it.each(['../andre', 'a/b', '..', '.', 'a\\b'])(
    'rejects a uid that could not name a directory: %s',
    (bad) => {
      expect(deriveUserId(req({ 'x-authentik-uid': bad }), { mode: 'deployed' })).toBeNull()
    },
  )

  it('reads the lowercased authentik uid header in deployed mode', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': 'ak-9f31' }), { mode: 'deployed' }),
    ).toBe('ak-9f31')
  })

  it('returns null rather than a default user when the header is missing', () => {
    expect(deriveUserId(req({}), { mode: 'deployed' })).toBeNull()
  })

  it('returns null when the header is empty', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': '' }), { mode: 'deployed' }),
    ).toBeNull()
  })

  it('returns null when the header is whitespace only', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': '   ' }), { mode: 'deployed' }),
    ).toBeNull()
  })

  it('trims surrounding whitespace on the uid', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': '  ak-9f31  ' }), { mode: 'deployed' }),
    ).toBe('ak-9f31')
  })

  // Repeated headers arrive as an array; node never coalesces them. Accepting
  // one would let a request smuggle a second value past whatever forwardAuth
  // set, so an array is treated as tampering, not as a uid to pick from.
  it('rejects an array-valued uid header instead of picking an element', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': ['ak-9f31', 'ak-0000'] }), { mode: 'deployed' }),
    ).toBeNull()
  })

  // Traefik's forwardAuth does not strip client-supplied headers of the same
  // name before it sets its own, so a client that sends x-gateway-secret
  // itself is a real path, not a hypothetical — this in-process check is the
  // backstop for that middleware-chain misconfiguration.
  it('rejects a valid uid when the gateway secret does not match', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': 'ak-9f31', 'x-gateway-secret': 'wrong' }), {
        mode: 'deployed',
        gatewaySecret: 'correct-secret',
      }),
    ).toBeNull()
  })

  it('accepts a valid uid when the gateway secret matches', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': 'ak-9f31', 'x-gateway-secret': 'correct-secret' }), {
        mode: 'deployed',
        gatewaySecret: 'correct-secret',
      }),
    ).toBe('ak-9f31')
  })

  it('rejects a missing gateway secret header when one is required', () => {
    expect(
      deriveUserId(req({ 'x-authentik-uid': 'ak-9f31' }), {
        mode: 'deployed',
        gatewaySecret: 'correct-secret',
      }),
    ).toBeNull()
  })
})
