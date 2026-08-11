import { describe, expect, it, vi } from 'vitest'
import { chromeInstalled, openDisabled, openInBrowser, openPlan } from './open-browser'

/**
 * The decision is tested; the launch is not. `openPlan` is pure so a test can
 * assert *what would be opened* without a browser appearing eleven times during
 * a suite run — which is also why `http-server.ts` calls this from `main()` and
 * never from `createVoiceServer`.
 */

describe('openPlan', () => {
  const URL = 'http://127.0.0.1:4174/'

  // The reason this module exists rather than a bare `open <url>`: per
  // AGENTS.md, Arc does not work at all and Safari needs HTTPS, and both
  // fail silently — no prompt, no rejection, mediaDevices simply absent.
  it('names Chrome explicitly rather than trusting the default browser', () => {
    expect(openPlan(URL, { platform: 'darwin', hasChrome: true })).toEqual({
      command: 'open',
      args: ['-a', 'Google Chrome', URL],
    })
  })

  it('falls back to the default browser when Chrome is not installed', () => {
    expect(openPlan(URL, { platform: 'darwin', hasChrome: false })).toEqual({
      command: 'open',
      args: [URL],
    })
  })

  it('opens nothing when the opt-out is set', () => {
    expect(openPlan(URL, { platform: 'darwin', hasChrome: true, disabled: true })).toBeNull()
  })

  it('uses xdg-open on linux', () => {
    expect(openPlan(URL, { platform: 'linux', hasChrome: false })).toEqual({
      command: 'xdg-open',
      args: [URL],
    })
  })

  it('opens nothing on a platform this repo does not target', () => {
    expect(openPlan(URL, { platform: 'win32', hasChrome: false })).toBeNull()
  })

  // The server binds IPv4 only and browsers try ::1 first, so a `localhost` URL
  // fails to connect in Chrome. Whatever it is handed, this must pass it through
  // untouched rather than "helpfully" rewriting a host.
  it('passes the URL through exactly as given', () => {
    const https = 'https://127.0.0.1:4174/'
    expect(openPlan(https, { platform: 'darwin', hasChrome: true })!.args).toContain(https)
    expect(openPlan(https, { platform: 'darwin', hasChrome: true })!.args.join(' ')).not.toContain('localhost')
  })
})

describe('chromeInstalled', () => {
  it('checks both the system and per-user application directories', () => {
    const seen: string[] = []
    chromeInstalled((path) => {
      seen.push(path)
      return false
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe('/Applications/Google Chrome.app')
    expect(seen[1]).toContain('Applications/Google Chrome.app')
    expect(seen[1]).not.toBe(seen[0])
  })

  it('is true as soon as one of them exists', () => {
    expect(chromeInstalled((path) => path.startsWith('/Applications'))).toBe(true)
    expect(chromeInstalled(() => false)).toBe(false)
  })
})

describe('openDisabled', () => {
  it('is off when the variable is absent', () => {
    expect(openDisabled({})).toBe(false)
  })

  it.each(['1', 'true', 'yes', 'please-dont'])('is on for %j', (value) => {
    expect(openDisabled({ VOICE_NO_OPEN: value })).toBe(true)
  })

  // An empty or explicitly-falsy value reads as "not set" rather than as "set",
  // so `VOICE_NO_OPEN=` in a shell profile does not silently disable this.
  it.each(['', '0', 'false', 'False'])('is off for %j', (value) => {
    expect(openDisabled({ VOICE_NO_OPEN: value })).toBe(false)
  })
})

describe('openInBrowser', () => {
  it('does nothing at all when there is no plan', () => {
    const log = vi.fn()
    openInBrowser(null, log)
    expect(log).not.toHaveBeenCalled()
  })

  // A browser that will not launch must not take the server with it: the URL is
  // already printed, so typing it is a complete recovery.
  it('reports a failure instead of throwing', async () => {
    const log = vi.fn()
    expect(() =>
      openInBrowser({ command: 'definitely-not-a-real-binary-xyz', args: ['http://127.0.0.1/'] }, log),
    ).not.toThrow()

    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0]![0]).toContain('Could not open a browser automatically')
  })
})
