import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { userDataDir } from './user-root'

const ROOT = '/srv/interview-prep'

describe('userDataDir', () => {
  // The hard requirement of the whole deployed-mode plan: local instances keep
  // working exactly as they do today. Every existing caller passes null, so if
  // this is not byte-for-byte the old path, the refactor has silently moved a
  // drill log, a story bank and every archived attempt.
  it('is the current local/ path when there is no user', () => {
    expect(userDataDir(ROOT, null)).toBe(join(ROOT, 'local'))
  })

  it('namespaces a user under local/users/', () => {
    expect(userDataDir(ROOT, 'ak-9f31')).toBe(join(ROOT, 'local/users/ak-9f31'))
  })

  // The id arrives on a request header. Authentik's uid is opaque and safe, but
  // this function is the only thing standing between that header and a path
  // join, and a traversal here reads and writes another user's drill log.
  // Rejecting is right rather than sanitising: a uid that needs rewriting is
  // not a uid this server has ever issued, so it is a bug or an attack, and
  // both deserve a throw over a quietly-corrected path.
  it.each(['../other', 'a/b', '..', '.', 'a/../../etc', 'a\\b'])(
    'refuses a user id that could escape its directory: %s',
    (bad) => {
      expect(() => userDataDir(ROOT, bad)).toThrow(/user id/i)
    },
  )

  it('refuses an empty user id rather than falling back to the shared dir', () => {
    // The dangerous case. Returning local/ here would hand a caller with a
    // blank header the owner's own data, which is the failure the 401 in
    // deriveUserId exists to prevent — so it must not be reachable by passing
    // an empty string instead of null.
    expect(() => userDataDir(ROOT, '')).toThrow(/user id/i)
  })
})
