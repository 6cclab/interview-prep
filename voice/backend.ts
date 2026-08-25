import Anthropic from '@anthropic-ai/sdk'
import { claudeCliStream, DEFAULT_CLAUDE_MODEL } from './claude-cli'
import { DEFAULT_OLLAMA_MODEL, ollamaStream } from './ollama'
import { DEFAULT_OPENAI_MODEL, openaiStream } from './openai'
import { anthropicStream, type StreamFn } from './interviewer'
import type { Track } from './context'

/**
 * Which model backend a track's interviewer runs on.
 *
 * Four exist and they are not interchangeable:
 *
 * - `cli` — `claude -p` against the logged-in subscription. The one every
 *   prompt rule in `context.ts` was written and tested against. There is
 *   deliberately no default: see `chooseBackend`.
 * - `api` — the Anthropic Messages API, spending Console credits.
 * - `ollama` — a local model over HTTP. Cheap and private, and materially
 *   worse at following the dense rules the prompts carry (exactly one
 *   question per turn, quote this hint rung verbatim, emit a fenced
 *   ```drill-log trailer). See `voice/ollama.ts` for the measurements.
 * - `openai` — any endpoint speaking OpenAI's `/v1/chat/completions` (OpenAI
 *   itself, Azure OpenAI, Groq, together, or a local vLLM / LM Studio server),
 *   spending that provider's credits. See `voice/openai.ts`.
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
export type Backend = 'cli' | 'api' | 'ollama' | 'openai'

const BACKENDS: readonly Backend[] = ['cli', 'api', 'ollama', 'openai']

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
  // Its own knob for the same reason coaching has one, from the other direction:
  // this track has no hint ladder and no worked solution to check itself
  // against, so the interviewer's judgement is the entire instrument. A weaker
  // model here does not produce an obviously bad drill, it produces a lenient
  // one — and a lenient assisted round is indistinguishable from a good
  // performance, which is the worst failure available.
  assisted: 'VOICE_BACKEND_ASSISTED',
  // Debugging is like coding on the two counts that matter for a weaker model:
  // it has a spoiler to leak and a fenced drill-log trailer to emit. Its own knob
  // all the same, so the arrangement stays "one variable per track" rather than
  // "one per track except the ones that were added later".
  debug: 'VOICE_BACKEND_DEBUG',
  // The practice tutor, and the coach's reasoning applies to it word for word:
  // it is teaching rather than asking, so a confident wrong explanation is the
  // failure mode, and no test suite in the loop contradicts it. The difference
  // is who notices — a coach is talking to someone who has already attempted the
  // problem, a tutor is often the first explanation a learner hears. Its own
  // knob so putting the drills on a local model does not silently move the
  // teaching there too.
  practice: 'VOICE_BACKEND_PRACTICE',
}

/** Every per-track variable name, for tests and for error messages. */
export const TRACK_VARS: readonly string[] = Object.values(TRACK_VAR)

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
 * Precedence: the track's own variable, then the global one. There is no
 * default — nothing set throws, because a transport you did not choose is a
 * transport you discover mid-drill. An unrecognised value also throws rather
 * than falling back — a typo (`VOICE_BACKEND=olama`) silently running a whole
 * session on the expensive path is the failure this refuses to have.
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

  throw new Error(
    `VOICE_BACKEND is not set, and there is no default — a transport you did not ` +
      `choose is one you discover mid-drill. Use one of:\n` +
      `  pnpm mock:web:claude   ${describeBackend('cli', DEFAULT_CLAUDE_MODEL)}\n` +
      `  pnpm mock:web:openai   ${describeBackend('openai', DEFAULT_OPENAI_MODEL)}\n` +
      `  pnpm mock:web:ollama   ${describeBackend('ollama', DEFAULT_OLLAMA_MODEL)}\n` +
      `  pnpm mock:web:hybrid   behavioural local, the rest on Claude\n` +
      `Or set ${GLOBAL_VAR} / ${trackVar} yourself.`,
  )
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
    case 'openai':
      return `Transport: OpenAI-compatible endpoint, model ${model} (spending that provider's credits)`
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
    debug: chooseBackend('debug', env),
    assisted: chooseBackend('assisted', env),
    practice: chooseBackend('practice', env),
  }
}

/**
 * One track's backend and model, as a single short line for a transcript header.
 *
 * Recorded per session because a transcript is the only artifact left after a
 * drill, and on 2026-08-10 a drill read wrong — the interviewer conducted it in
 * the third person — with no way to tell from the file which model had produced
 * it. The startup banner says what the *server* is on; a transcript kept days
 * later needs to say what *that session* was on.
 */
export function transportLabel(track: Track, env: NodeJS.ProcessEnv = process.env): string {
  const backend = chooseBackend(track, env)
  return `${backend} / ${modelFor(backend, env)}`
}

/** The model a backend would use, given `env`. Shared by the label and the banner. */
export function modelFor(backend: Backend, env: NodeJS.ProcessEnv = process.env): string {
  switch (backend) {
    case 'ollama':
      return env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL
    case 'openai':
      return env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL
    case 'api':
    case 'cli':
      return env.VOICE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL
  }
}

/**
 * The transport for a track, and the line announcing it.
 *
 * One copy. `voice/cli.ts` and `voice/http-server.ts` each had their own, which
 * meant every new backend had to be added twice and the two could disagree
 * about what `VOICE_BACKEND_DESIGN=ollama` meant depending on where the drill
 * was run. Adding a fourth backend is what made that cost real.
 *
 * `log` is injected rather than calling `console.log` directly because the two
 * callers prefix differently — the server names the track, the CLI does not.
 */
export function streamForBackend(
  track: Track,
  log: (line: string) => void = console.log,
): StreamFn {
  const backend = chooseBackend(track)
  const model = modelFor(backend)
  log(describeBackend(backend, model))
  switch (backend) {
    case 'ollama':
      return ollamaStream()
    case 'openai':
      return openaiStream()
    case 'api':
      return anthropicStream(new Anthropic(), model)
    case 'cli':
      return claudeCliStream({ model })
  }
}
