import type { Track } from './context'

/**
 * Which model backend a track's interviewer runs on.
 *
 * Three exist and they are not interchangeable:
 *
 * - `cli` — `claude -p` against the logged-in subscription. The default,
 *   because it is the only one every prompt rule in `context.ts` was written
 *   and tested against.
 * - `api` — the Anthropic Messages API, spending Console credits.
 * - `ollama` — a local model over HTTP. Cheap and private, and materially
 *   worse at following the dense rules the prompts carry (exactly one
 *   question per turn, quote this hint rung verbatim, emit a fenced
 *   ```drill-log trailer). See `voice/ollama.ts` for the measurements.
 *
 * **Selection is explicit, and per track.** The tracks are not equally
 * forgiving of a weaker model: `mock` is behavioural, so it has no spoiler to
 * leak, no hint ladder and no fenced trailer to emit — it is the safe place to
 * put a local model. `coding` is the opposite on all three counts. So the knob
 * has to be per track, or the choice is a choice about the worst track.
 *
 * Nothing here sniffs for a running ollama or an available key and switches
 * silently. The previous arrangement did — `ANTHROPIC_API_KEY` being present
 * anywhere in the environment quietly outranked the subscription — and a
 * transport you did not choose is a transport you discover mid-drill.
 */
export type Backend = 'cli' | 'api' | 'ollama'

const BACKENDS: readonly Backend[] = ['cli', 'api', 'ollama']

/** The default when nothing is set. See `Backend` for why it is not `ollama`. */
export const DEFAULT_BACKEND: Backend = 'cli'

/**
 * Per-track override variable names.
 *
 * Spelled out rather than built from the track name so that grepping the repo
 * for `VOICE_BACKEND_CODING` finds this table.
 */
const TRACK_VAR: Record<Track, string> = {
  mock: 'VOICE_BACKEND_MOCK',
  design: 'VOICE_BACKEND_DESIGN',
  coding: 'VOICE_BACKEND_CODING',
  // Coaching is the one track where a weaker model is most likely to be wrong in
  // a way that is hard to notice: it is teaching rather than asking, so a
  // confident wrong explanation is the failure mode, and there is no test suite
  // in the loop to contradict it. Its own knob, so putting the drills on a local
  // model does not silently move the teaching there too.
  coach: 'VOICE_BACKEND_COACH',
}

/** The global variable, applied to any track without its own override. */
const GLOBAL_VAR = 'VOICE_BACKEND'

function parse(value: string, varName: string): Backend {
  const normalised = value.trim().toLowerCase()
  if ((BACKENDS as readonly string[]).includes(normalised)) return normalised as Backend
  throw new Error(
    `${varName}="${value}" is not a known backend. Use one of: ${BACKENDS.join(', ')}.`,
  )
}

/**
 * The backend for `track`, from `env`.
 *
 * Precedence: the track's own variable, then the global one, then the default.
 * An unrecognised value throws rather than falling back — a typo
 * (`VOICE_BACKEND=olama`) silently running a whole session on the expensive
 * path is the failure this refuses to have.
 *
 * An empty or whitespace-only value is treated as unset, so
 * `VOICE_BACKEND= pnpm mock:web` clears an inherited export instead of
 * erroring.
 */
export function chooseBackend(track: Track, env: NodeJS.ProcessEnv = process.env): Backend {
  const trackVar = TRACK_VAR[track]
  const trackValue = env[trackVar]
  if (trackValue !== undefined && trackValue.trim() !== '') return parse(trackValue, trackVar)

  const globalValue = env[GLOBAL_VAR]
  if (globalValue !== undefined && globalValue.trim() !== '') return parse(globalValue, GLOBAL_VAR)

  return DEFAULT_BACKEND
}

/**
 * One line naming the backend and what it spends, logged when a session starts.
 *
 * The cost clause is the point: the reason to reach for any of this is that
 * subscription quota is finite, so which pocket a drill is coming out of
 * should be on screen before the drill, not inferred afterwards.
 */
export function describeBackend(backend: Backend, model: string): string {
  switch (backend) {
    case 'api':
      return `Transport: Anthropic Messages API, model ${model} (spending Console credits)`
    case 'ollama':
      return `Transport: ollama, model ${model} (local, spending nothing)`
    case 'cli':
      return `Transport: claude CLI, model ${model} (spending Claude subscription quota)`
  }
}

/**
 * Every track's backend, for the startup banner.
 *
 * Printed as a set at boot because the per-track knob makes a hybrid the
 * expected arrangement, and a hybrid you cannot see is one you will
 * misattribute a bad drill to.
 */
export function backendSummary(env: NodeJS.ProcessEnv = process.env): Record<Track, Backend> {
  return {
    mock: chooseBackend('mock', env),
    design: chooseBackend('design', env),
    coding: chooseBackend('coding', env),
    coach: chooseBackend('coach', env),
  }
}
