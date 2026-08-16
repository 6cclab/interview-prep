/**
 * What the environment says this instance is.
 *
 * `main()` is a process entry point and not directly testable, so the part of
 * it that decides local-versus-deployed lives here where it can be. Everything
 * here is derived from `env` alone — no filesystem, no process state.
 */

export interface ServerConfig {
  mode: 'local' | 'deployed'
  /** The interface to listen on. */
  host: string
  /** Whether the server may drive its own audio device. */
  speaks: boolean
  coachAllowlist: ReadonlySet<string>
  gatewaySecret: string | undefined
  /**
   * Whether this instance serves more than one person.
   *
   * Off by default, including deployed: an instance is one candidate's until
   * told otherwise, and isolation comes from running one per person rather than
   * from identity handling inside the process. The identity machinery is all
   * still here — `deriveUserId`, `userDataDir`, the coach allowlist, the
   * gateway secret — and this is the switch that decides whether it is
   * consulted, so turning it back on is one variable rather than a rewrite.
   */
  multiUser: boolean
}

/** Env values that mean "this is a deployed instance". */
const MODES = new Set(['local', 'deployed'])

/** Hostnames that mean "this machine" — correct locally, never in a container. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/**
 * Refuse to start a deployed instance pointed at its own loopback for ollama.
 *
 * `OLLAMA_HOST` defaults to `http://127.0.0.1:11434` — ollama's own default,
 * and the right answer on the machine you are sitting at. In a container it
 * addresses the container, where nothing is listening, and the only warning is
 * one `preloadOllama` line at boot. The drill then dies on its first turn,
 * which is the failure `chooseBackend` already refuses to allow for the
 * transport itself: "a transport you did not choose is one you discover
 * mid-drill."
 *
 * `backends` is passed rather than read here so this stays a pure check, and so
 * a deployed instance on some other transport is not made to configure a host
 * it will never call.
 */
export function assertOllamaReachable(
  env: NodeJS.ProcessEnv,
  backends: Readonly<Record<string, string>>,
): void {
  if (serverConfig(env).mode !== 'deployed') return
  if (!Object.values(backends).includes('ollama')) return
  const raw = (env.OLLAMA_HOST ?? '').trim()
  const host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
  if (raw !== '' && !LOOPBACK.has(host)) return
  throw new Error(
    `OLLAMA_HOST is ${raw === '' ? 'unset, which means ollama\'s own 127.0.0.1 default' : `"${raw}"`}, and a ` +
      'deployed instance addressing its own loopback reaches nothing. Point it at the gateway, e.g. ' +
      'http://ollama-gateway.ollama-gateway.svc.cluster.local.',
  )
}

export function serverConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = (env.VOICE_MODE ?? '').trim().toLowerCase()
  // A typo must not quietly mean local: local mode has no identity check and no
  // per-user directories, so falling back to it would serve every user out of
  // one candidate's `local/` with nothing asking who they are.
  if (raw !== '' && !MODES.has(raw)) {
    throw new Error(`VOICE_MODE="${env.VOICE_MODE}" is not a known mode. Use one of: local, deployed.`)
  }
  const mode = raw === 'deployed' ? 'deployed' : 'local'
  const multiUser = (env.VOICE_MULTI_USER ?? '').trim() !== ''
  // Local mode's whole guarantee is that `userDataDir(root, null)` is `local/`.
  // Switching per-user state on there would move an existing drill log into a
  // subdirectory the next time the server started, silently.
  if (multiUser && mode !== 'deployed') {
    throw new Error('VOICE_MULTI_USER only means something for a deployed instance. A local one is already yours.')
  }
  const secret = (env.VOICE_GATEWAY_SECRET ?? '').trim()
  return {
    mode,
    // 127.0.0.1 stays the local answer — a live microphone and a private story
    // bank have no business on the network. Inside a container it means the
    // opposite of safe: nothing outside the container can connect at all.
    host: mode === 'deployed' ? '0.0.0.0' : '127.0.0.1',
    // `voice/speech.ts` spawns `say` or `piper` on the machine the server runs
    // on. Deployed, that is not the user's machine.
    speaks: mode === 'local',
    coachAllowlist: new Set(
      (env.VOICE_COACH_ALLOWLIST ?? '')
        .split(',')
        .map((entry) => entry.trim())
        // An empty uid is what a header-stripping mistake produces, and it must
        // never be a member of the set.
        .filter((entry) => entry !== ''),
    ),
    gatewaySecret: secret === '' ? undefined : secret,
    multiUser,
  }
}
