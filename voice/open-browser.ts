import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Opens the drill in a browser once the server is listening.
 *
 * Two commands and a remembered port is friction sitting directly in front of
 * the thing this repo exists to make him do, and `local/drill-log.md` has no
 * rows in it. This removes the second step.
 *
 * **Chrome by name, not the default browser.** That is the whole reason this is
 * not a one-line `open <url>`: `AGENTS.md`'s browser table says Arc does
 * not work at all and Safari needs HTTPS, and the failure is silent — no prompt,
 * no rejection, `navigator.mediaDevices` simply absent. Handing the URL to
 * whatever browser happens to be the default is how someone ends up debugging a
 * microphone that was never going to be offered to them.
 *
 * Called only from `http-server.ts`'s `main()`, never from `createVoiceServer`.
 * The server is constructed directly by a dozen tests, and a suite that launches
 * a browser twelve times is its own kind of hostile.
 */

/** Where Chrome lives, in the order worth checking. */
const CHROME_PATHS = [
  '/Applications/Google Chrome.app',
  join(homedir(), 'Applications/Google Chrome.app'),
]

/** Whether a Chrome install is actually present, rather than assumed. */
export function chromeInstalled(exists: (path: string) => boolean = existsSync): boolean {
  return CHROME_PATHS.some(exists)
}

export interface OpenPlan {
  command: string
  args: string[]
}

/**
 * The command to open `url`, or `null` when nothing should be launched.
 *
 * Pure, so the decision can be tested without launching anything — the
 * alternative is a test that either opens a real browser or asserts nothing.
 *
 * `null` covers two cases deliberately kept distinct from a failure: the opt-out
 * being set, and a platform this repo does not target. Neither is an error, and
 * neither should print a warning.
 */
export function openPlan(
  url: string,
  opts: { platform?: string; disabled?: boolean; hasChrome?: boolean } = {},
): OpenPlan | null {
  const { platform = process.platform, disabled = false, hasChrome = chromeInstalled() } = opts
  if (disabled) return null

  if (platform === 'darwin') {
    // Falls back to the default browser rather than refusing: without Chrome the
    // page may still work (Firefox is fine per the same table), and the console
    // already prints the caveat. Silently opening nothing would be worse.
    return hasChrome
      ? { command: 'open', args: ['-a', 'Google Chrome', url] }
      : { command: 'open', args: [url] }
  }
  if (platform === 'linux') return { command: 'xdg-open', args: [url] }
  return null
}

/** True when the opt-out is set to anything other than an explicit falsy value. */
export function openDisabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.VOICE_NO_OPEN
  if (raw === undefined) return false
  return raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false'
}

/**
 * Launch the browser, reporting rather than throwing.
 *
 * A browser that will not open must never take the server with it: the URL is
 * already on screen and typing it is a complete recovery, so the failure is
 * worth one line and nothing more.
 */
export function openInBrowser(plan: OpenPlan | null, log: (message: string) => void = console.log): void {
  if (!plan) return
  execFile(plan.command, plan.args, (error) => {
    if (error) log(`Could not open a browser automatically (${error.message}). Open the URL above yourself.`)
  })
}
