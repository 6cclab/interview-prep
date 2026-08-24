import { describe, expect, it, vi } from 'vitest'
import { teardownDisconnectedClient } from './http-server'

/**
 * Teardown runs inside an `IncomingMessage` `'close'` handler, where a throw is
 * an unhandled exception rather than a rejected promise — it takes the whole
 * drill server down, at a disconnect.
 *
 * It became `async` when the record store did, which widens rather than narrows
 * what it has to swallow: the `'close'` listener cannot await it, so a rejection
 * would escape as an unhandled one. Every case below is therefore asserted as a
 * promise that resolves, not merely as a call that does not throw — the two are
 * different questions now, and only the second one used to exist.
 *
 * This was a real crash: removing the default backend made `chooseBackend`
 * throw, `endAndPersist` reaches it through `transportLabel`, and closing a tab
 * with `VOICE_BACKEND` unset killed the server. The harness reported it as 13
 * unhandled exceptions while every test still passed.
 */
describe('teardownDisconnectedClient', () => {
  const noStore = { get: () => undefined, activeId: () => undefined } as never

  it('does not throw when the speaker fails to stop', async () => {
    const speaker = {
      speak: async () => {},
      stop: () => {
        throw new Error('say: device vanished')
      },
    }
    await expect(
      teardownDisconnectedClient({ speaker } as never, noStore, new Map(), new Set(), 'sid'),
    ).resolves.toBeUndefined()
  })

  // The transcript is the only artifact a finished drill leaves. A speaker that
  // cannot be stopped must not cost it, which is why these are two try blocks.
  it('still ends the session when the speaker throws', async () => {
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
    await teardownDisconnectedClient({ speaker } as never, store, new Map(), new Set(), 'sid')
    expect(ended).toBe(true)
  })

  it('does not throw when ending the session throws', async () => {
    const store = {
      get: () => {
        throw new Error('VOICE_BACKEND is not set')
      },
      activeId: () => undefined,
    } as never
    await expect(
      teardownDisconnectedClient({} as never, store, new Map(), new Set(), 'sid'),
    ).resolves.toBeUndefined()
  })

  it('reports what it swallowed rather than failing silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = {
      get: () => {
        throw new Error('VOICE_BACKEND is not set')
      },
      activeId: () => undefined,
    } as never
    await teardownDisconnectedClient({} as never, store, new Map(), new Set(), 'sid')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('VOICE_BACKEND is not set'))
    spy.mockRestore()
  })
})
