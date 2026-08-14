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
}

/** Env values that mean "this is a deployed instance". */
const MODES = new Set(['local', 'deployed'])

export function serverConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = (env.VOICE_MODE ?? '').trim().toLowerCase()
  // A typo must not quietly mean local: local mode has no identity check and no
  // per-user directories, so falling back to it would serve every user out of
  // one candidate's `local/` with nothing asking who they are.
  if (raw !== '' && !MODES.has(raw)) {
    throw new Error(`VOICE_MODE="${env.VOICE_MODE}" is not a known mode. Use one of: local, deployed.`)
  }
  const mode = raw === 'deployed' ? 'deployed' : 'local'
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
  }
}
