import { describe, expect, it, vi } from 'vitest'
import { teardownDisconnectedClient } from './http-server'

/**
 * Teardown runs inside an `IncomingMessage` `'close'` handler, where a throw is
 * an unhandled exception rather than a rejected promise — it takes the whole
 * drill server down, at a disconnect.
 *
 * This was a real crash: removing the default backend made `chooseBackend`
 * throw, `endAndPersist` reaches it through `transportLabel`, and closing a tab
 * with `VOICE_BACKEND` unset killed the server. The harness reported it as 13
 * unhandled exceptions while every test still passed.
 */
describe('teardownDisconnectedClient', () => {
  const noStore = { get: () => undefined, activeId: () => undefined } as never

  it('does not throw when the speaker fails to stop', () => {
    const speaker = {
      speak: async () => {},
      stop: () => {
        throw new Error('say: device vanished')
      },
    }
    expect(() =>
      teardownDisconnectedClient({ speaker } as never, noStore, new Map(), new Set(), 'sid'),
    ).not.toThrow()
  })

  // The transcript is the only artifact a finished drill leaves. A speaker that
  // cannot be stopped must not cost it, which is why these are two try blocks.
  it('still ends the session when the speaker throws', () => {
    let ended = false
    const speaker = {
      speak: async () => {},
      stop: () => {
        throw new Error('say: device vanished')
      },
    }
    const store = {
      get: () => {
        ended = true
        return undefined
      },
      activeId: () => undefined,
    } as never
    teardownDisconnectedClient({ speaker } as never, store, new Map(), new Set(), 'sid')
    expect(ended).toBe(true)
  })

  it('does not throw when ending the session throws', () => {
    const store = {
      get: () => {
        throw new Error('VOICE_BACKEND is not set')
      },
      activeId: () => undefined,
    } as never
    expect(() =>
      teardownDisconnectedClient({} as never, store, new Map(), new Set(), 'sid'),
    ).not.toThrow()
  })

  it('reports what it swallowed rather than failing silently', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = {
      get: () => {
        throw new Error('VOICE_BACKEND is not set')
      },
      activeId: () => undefined,
    } as never
    teardownDisconnectedClient({} as never, store, new Map(), new Set(), 'sid')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('VOICE_BACKEND is not set'))
    spy.mockRestore()
  })
})
