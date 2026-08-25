import { feedLines } from './claude-cli'
import type { Message, StreamFn } from './interviewer'
import { UNTRUSTED_NOTICE } from './prompt-framing'
import { createThinkGate, type ModelDelta, type ThinkGate } from './think-gate'

/**
 * A `StreamFn` backed by a local ollama server.
 *
 * Free and private, and weaker than the Claude backends at the thing these
 * prompts actually ask for. Every number here was measured against a real
 * server (ollama 0.24.0 on the LAN) rather than assumed:
 *
 * | | Measured |
 * |---|---|
 * | Generation | 314 tokens in 6.14s — 51 tok/s |
 * | Prompt prefill | 53 tokens in 0.18s |
 * | Cold model load | ~168s for 18GB, first request |
 * | Reload after `keep_alive` lapsed | 6.2s |
 * | Full turn, real 34k-char system prompt | 13.4s first, 4.8s second |
 *
 * 51 tok/s outruns the text-to-speech comfortably, so throughput is not the
 * constraint. Two other things are, and both are handled here rather than
 * left to the caller:
 *
 * **Thinking leaks into `content`.** That measured turn was sent with
 * `think: false` and the server ignored it: 307 of the 314 tokens were the
 * model's deliberation, emitted as ordinary `message.content` and terminated
 * by a bare `</think>` with no opening tag. The reply itself was seven tokens.
 * `SentenceBuffer` turns content into spoken sentences, so unfiltered that
 * deliberation is read aloud — and on the coding track the deliberation says
 * what the model thinks the answer is, which makes it a spoiler leaving the
 * speaker. `createThinkGate` below is the fix and is the reason this transport
 * is not a thin `fetch` wrapper.
 *
 * **The context window truncates silently.** ollama's default `num_ctx` is
 * 4096 and it drops the oldest tokens without saying so. A 45-minute design
 * transcript passes that easily, and the failure is not an error — it is an
 * interviewer that has quietly forgotten the problem statement, the time
 * check and how many hints it has given. `num_ctx` is therefore always sent
 * explicitly, and defaults high.
 */

/** ollama's own default when `OLLAMA_HOST` is unset. */
const DEFAULT_HOST = 'http://127.0.0.1:11434'

/**
 * Chosen by measurement, not by size — and changed on 2026-08-10 after the
 * comparison the previous note asked for.
 *
 * Measured on the P40 box (LXC 113, ollama 0.24.0), same interviewer-style
 * prompt, `num_ctx: 8192`. Steady-state generation rate, cold load excluded:
 *
 * | model | gen tok/s | prompt tok/s | deliberation lands in |
 * |---|---|---|---|
 * | **`gpt-oss:20b`** | **44.8** | **404** | **its own `thinking` field** |
 * | `qwen3:30b-a3b` | 52.2 | 277 | `content` — leaks |
 * | `Qwen3.5:9b` (previous default) | 30.2 | 315 | n/a, does not think |
 * | `qwen3:14b` | 22.3 | 269 | n/a |
 * | `granite4.1:30b` | 12.0 | 118 | n/a |
 *
 * **`gpt-oss:20b` is ~1.5x the previous default's generation rate and ~1.3x its
 * prompt rate, at roughly twice the parameter count.** On the mock prompt it
 * returned exactly one question and no preamble, with `think` both false and
 * true.
 *
 * **Then the multi-turn test reversed it, and the default stayed on the 9B.**
 * Four-turn behavioural mocks through the real `context.ts` rules, three runs of
 * gpt-oss and two of Qwen:
 *
 * | | `Qwen3.5:9b` | `gpt-oss:20b` |
 * |---|---|---|
 * | Tokens per 4-turn mock | **121-126** | 437-596 |
 * | Wall clock per turn | **~1.0s** | ~2.8s |
 * | Deliberation leaked into `content` | never | **1 turn in 12** |
 * | HTTP 500 mid-session | never | once, unexplained |
 *
 * **The tok/s advantage is a mirage.** gpt-oss is 1.5x faster per token and
 * spends 4x the tokens getting to the same sentence, because the reasoning is
 * billed to the same budget. Net, it is **~2.6x slower per turn** — and the turn
 * is what the candidate waits through.
 *
 * **The channel separation is not reliable either**, which was the whole reason
 * to prefer it. It is clean most of the time, then emits `"The user said hardest
 * part was getting SRE aligned... Or: ... Need to ask one question. I'll ask:"`
 * as ordinary content. `createThinkGate` is therefore still load-bearing, so the
 * ~6s it costs is not recovered.
 *
 * **On question quality the 9B is better, not merely cheaper.** It engages with
 * what was actually said — *"what was the specific mechanism you used to detect
 * and automatically roll back when an error rate spiked during the canary
 * window?"* — where gpt-oss reaches for the generic *"what were the biggest
 * challenges you faced during that migration?"* more often than not.
 *
 * Both models compound two questions with "and", which `context.ts` forbids and
 * a naive `?`-counter misses. That is a prompt problem, not a model choice.
 *
 * `qwen3:30b-a3b` was also rejected: fastest per token (52.2 tok/s, ~3B active)
 * but with `think: false` it dumped 1,858 characters of "Okay, the user wants me
 * to..." into `content` (`/no_think` did not help), and with `think: true` it
 * burned all 400 tokens deliberating and returned an **empty** `content`.
 *
 * **Standing lesson: throughput is the wrong metric.** Tokens-per-turn times
 * seconds-per-token is the one the candidate experiences, and a reasoning model
 * loses on it even while winning the benchmark.
 *
 * **The default is now `qwen3.8:latest` (17.7 GB on the box), by Andre's call.**
 * Everything above is left standing because it is the record of why the 9B held
 * the default for as long as it did, and because its standing lesson —
 * tokens-per-turn times seconds-per-token, not tok/s — is the metric any future
 * comparison has to use.
 *
 * **Re-measured on 2026-08-25**, four-turn behavioural mocks through the real
 * `context.ts` prompt, `think: true`, `num_ctx: 32768`, two runs each, read off
 * ollama's own `eval_count` / `eval_duration` rather than off a stopwatch:
 *
 * | | `Qwen3.5:9b` | `qwen3.8:latest` |
 * |---|---|---|
 * | Generation rate | 27.5, 27.4 tok/s | 13.8, 14.9 tok/s |
 * | Tokens per turn | 2391, 1108 | **492, 1106** |
 * | Seconds per turn | 86.8, 40.4 | 35.7, 74.4 |
 * | Share of tokens that are deliberation | **0.93, 0.94** | 0.75, 0.74 |
 * | Deliberation leaked into `content` | 0 of 8 | 0 of 8 |
 * | Compounded "and" questions | 2, 1 of 4 | 1, 1 of 4 |
 * | Cold load | — | 12.1s |
 *
 * **The standing lesson survives and sharpens.** `qwen3.8` runs at *half* the
 * 9B's throughput and is no slower per turn, because it spends a third of the
 * tokens getting to the answer. Throughput remains the wrong metric; the
 * candidate waits through tokens-per-turn times seconds-per-token.
 *
 * **The leak is gone on both, and that is the `think: true` change, not the
 * model.** Zero deliberation reached `content` in sixteen turns. The gate is
 * still load-bearing for a server that ignores the flag — but on this server,
 * with the flag honoured, it has nothing to catch.
 *
 * **Three quarters to nine tenths of every generated token is deliberation the
 * reader never sees.** That is not waste to be optimised away — it is what
 * bought the clean `content` — but it is the entire latency story, and it is
 * why the practice tutor needed `VOICE_MODEL_PRACTICE` rather than a faster
 * transport. See `voice/backend.ts`.
 *
 * **Compounding two questions with "and" is still a prompt problem.** Both
 * models do it on one to two turns in four, which is what the 2026-08-10 note
 * said and what a naive `?`-counter still misses.
 *
 * **Caveat on all of the above: n=2, and the variance is larger than the
 * difference.** Tokens per turn moved by more than 2x between runs of the
 * *same* model, so the per-turn seconds here separate nothing. Only the
 * generation rate (stable to 0.4%) and the deliberation share (stable to 0.01)
 * are tight enough to lean on. A decision that turns on wall clock needs more
 * runs than this.
 *
 * Tags are case-sensitive: `Qwen3.5:9b` is published with a capital Q and
 * `qwen3.5:9b` is a 404, whereas `qwen3.8:latest` is lowercase. Override either
 * with `OLLAMA_MODEL`.
 */
export const DEFAULT_OLLAMA_MODEL = 'qwen3.8:latest'

/**
 * Big enough that a full-length design drill does not silently truncate.
 *
 * A 45-minute transcript plus the system prompt lands in the low thousands of
 * tokens, so this is roughly 4x headroom rather than a tight fit — the cost of
 * being wrong here is invisible amnesia, and the cost of over-provisioning is
 * some RAM.
 */
const DEFAULT_NUM_CTX = 32768

/**
 * Longer than the measured 168s cold load, because that load happens inside
 * the first request. `preload` exists to move it off the drill's clock, but
 * this has to survive the case where it was not called.
 */
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000

/** How long ollama holds the model in memory after a request. Spans a whole drill, so no turn pays the reload. */
const DEFAULT_KEEP_ALIVE = '30m'

export interface OllamaOptions {
  /** Defaults to `OLLAMA_HOST`, then ollama's own default. */
  host?: string
  /** Defaults to `OLLAMA_MODEL`, then `DEFAULT_OLLAMA_MODEL`. */
  model?: string
  numCtx?: number
  keepAlive?: string
  timeoutMs?: number
  /**
   * Defaults to `OLLAMA_API_KEY`. Absent means unauthenticated, which is what
   * talking straight to an ollama box requires — see `ollamaHeaders`.
   */
  apiKey?: string
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch
}

export class OllamaTimeoutError extends Error {
  constructor(timeoutMs: number, host: string, model: string) {
    super(
      `ollama produced no output for ${timeoutMs}ms and the request was aborted. ` +
        `A first request has to load the model into memory, which was measured at ~168s ` +
        `for an 18GB model — check that ${host} is reachable and that "${model}" is pulled ` +
        `(\`ollama list\`), then retry.`,
    )
    this.name = 'OllamaTimeoutError'
  }
}

/**
 * Request headers for both call sites in this module.
 *
 * ollama itself takes no credentials, and pointing `OLLAMA_HOST` straight at a
 * box must keep working — so **absent means unauthenticated**, and that is the
 * default rather than an error. The bearer token exists for `ollama-gateway`
 * (`~/projects/ollama-gateway`), which fronts several boxes behind one address
 * and rejects every route but `/healthz` without one. The gateway is an
 * addition, not a migration: a drill should not start depending on a service
 * that can be down.
 *
 * A blank value reads as unset, matching how `chooseBackend` treats its own
 * variables, so `OLLAMA_API_KEY= ` clears an inherited export rather than
 * sending `Bearer `.
 *
 * One definition used by both `preloadOllama` and `ollamaStream`: they were the
 * two sites that had to change together, and two copies of an auth header drift.
 */
export function ollamaHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = (apiKey ?? '').trim()
  if (key !== '') headers.authorization = `Bearer ${key}`
  return headers
}

/**
 * `OLLAMA_HOST` may be a bare `host:port` as well as a URL — ollama's own CLI
 * accepts both, so this has to as well or a working shell config breaks here.
 */
export function normaliseHost(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_HOST
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '')
  return `http://${value.replace(/\/+$/, '')}`
}

/**
 * The `/api/chat` request body.
 *
 * `messages` carries the system prompt as a real system-role message and each
 * turn in its own role, so turn boundaries are structural here — unlike the
 * `claude -p` transport, which renders one flat string and therefore needs the
 * nonce-tagged framing in `formatPrompt` to keep a candidate's transcribed
 * speech from being read as a directive. Roles do that job here, but the
 * standing instruction is kept as well: candidate speech reaches this prompt
 * verbatim and is untrusted regardless of which field it arrives in.
 */
export function ollamaChatBody(
  system: string,
  messages: Message[],
  opts: { model: string; numCtx: number; keepAlive: string; think: boolean },
): Record<string, unknown> {
  return {
    model: opts.model,
    stream: true,
    keep_alive: opts.keepAlive,
    // Ask for deliberation in `message.thinking` rather than `message.content`.
    //
    // This used to be hard `false`, on the reasoning that 0.24.0 ignored it and
    // so the gate had to do the work anyway. That was true and it was also the
    // wrong default, because a reasoning model told not to use a thinking
    // channel does not stop reasoning — it reasons in prose, in `content`,
    // untagged, where the gate cannot see it. Measured on `qwen3.8:latest` via
    // ollama 0.32.15, same question either way:
    //
    //   think: false -> 1350+ chars of "Wait — there's a subtler problem",
    //                   a bug asserted then walked back, answer wrong
    //   think: true  -> 3097 chars into `thinking`, 432 into `content`,
    //                   three sentences, no narration, answer right
    //
    // `createThinkGate` stays: a server that ignores the flag, or a model that
    // emits `</think>` into content, are both still real. The flag makes the
    // clean case clean; the gate covers the rest.
    think: opts.think,
    options: { num_ctx: opts.numCtx },
    messages: [
      { role: 'system', content: `${system}\n\n${UNTRUSTED_NOTICE}` },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  }
}

/**
 * Narrows one parsed NDJSON line to its text, or null.
 *
 * Returns the `thinking` flag separately rather than merging the two fields:
 * a server that populates `message.thinking` is one that is keeping
 * deliberation out of `content`, and that fact is what lets the gate below
 * stop buffering. Merging them would throw away the signal.
 */
export function extractOllamaDelta(parsed: unknown): ModelDelta | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const line = parsed as { message?: { content?: unknown; thinking?: unknown } }
  const message = line.message
  if (typeof message !== 'object' || message === null) return null
  if (typeof message.thinking === 'string' && message.thinking !== '') {
    return { content: '', thinking: true }
  }
  if (typeof message.content !== 'string') return null
  return { content: message.content, thinking: false }
}

/** Reads an in-stream `{"error": "..."}` line, or null. `/api/chat` reports a bad model this way. */
export function extractOllamaError(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const line = parsed as { error?: unknown }
  if (typeof line.error !== 'string' || line.error === '') return null
  return line.error
}

/**
 * A single request that loads the model into memory, so no drill turn pays the
 * measured ~168s cold load.
 *
 * Reports rather than throws: a warm cache is an optimisation, and failing to
 * start the server because a preload could not reach ollama would be worse
 * than the slow first turn it was trying to avoid. `main()` logs what it
 * returns.
 */
export async function preloadOllama(opts: OllamaOptions = {}): Promise<string> {
  const host = normaliseHost(opts.host ?? process.env.OLLAMA_HOST)
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL
  const doFetch = opts.fetchImpl ?? fetch
  const apiKey = opts.apiKey ?? process.env.OLLAMA_API_KEY
  try {
    // An empty `messages` array asks ollama to load the model and return
    // immediately without generating anything.
    const res = await doFetch(`${host}/api/chat`, {
      method: 'POST',
      headers: ollamaHeaders(apiKey),
      body: JSON.stringify({ model, messages: [], keep_alive: opts.keepAlive ?? DEFAULT_KEEP_ALIVE }),
    })
    if (!res.ok) {
      return `ollama preload failed (HTTP ${res.status}) — the first drill turn will pay the model load.`
    }
    return `ollama: ${model} loaded and held on ${host}.`
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `ollama preload could not reach ${host} (${detail}) — check the server before starting a drill.`
  }
}

/**
 * Does this error mean the model has no thinking channel?
 *
 * ollama answers `think: true` for a non-reasoning model with HTTP 400 and
 * `"llama3.1:8b" does not support thinking` — measured on 0.32.15. That is a
 * fact about the model, not about the request, so it is worth one silent retry
 * with the flag off rather than surfacing as a failed drill.
 */
export function isThinkingUnsupported(reason: string): boolean {
  return /does not support thinking/i.test(reason)
}

export function ollamaStream(opts: OllamaOptions = {}): StreamFn {
  const host = normaliseHost(opts.host ?? process.env.OLLAMA_HOST)
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL
  const numCtx = opts.numCtx ?? Number(process.env.OLLAMA_NUM_CTX ?? DEFAULT_NUM_CTX)
  const keepAlive = opts.keepAlive ?? DEFAULT_KEEP_ALIVE
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const apiKey = opts.apiKey ?? process.env.OLLAMA_API_KEY
  const doFetch = opts.fetchImpl ?? fetch
  // Whether this model accepts `think`. Assumed until the server says no, then
  // remembered for the life of this stream function — the model cannot change
  // underneath it, so one discovery is enough.
  let thinkSupported = true

  return async function* (system, messages) {
    const controller = new AbortController()
    // Re-armed on every chunk, so this bounds silence rather than total
    // duration — a long reply that keeps producing tokens is not a hang.
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    const arm = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    }

    try {
      arm()
      const send = async (think: boolean): Promise<Response> => {
        try {
          return await doFetch(`${host}/api/chat`, {
            method: 'POST',
            headers: ollamaHeaders(apiKey),
            body: JSON.stringify(
              ollamaChatBody(system, messages, { model, numCtx, keepAlive, think }),
            ),
            signal: controller.signal,
          })
        } catch (error) {
          if (timedOut) throw new OllamaTimeoutError(timeoutMs, host, model)
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(`could not reach ollama at ${host}: ${detail}`)
        }
      }

      let res = await send(thinkSupported)
      if (!res.ok) {
        // ollama puts the reason in a JSON body — "model not found" for an
        // unpulled model, which is the mistake worth naming precisely.
        const body = await res.text().catch(() => '')
        const reason = extractOllamaError(safeParse(body)) ?? body.trim()
        // A model with no thinking channel refuses the flag outright. Retry
        // once without it and remember, so the second turn does not pay for
        // the same discovery. Remembered per stream function, not globally:
        // the model is fixed for the life of one of these.
        if (thinkSupported && isThinkingUnsupported(reason)) {
          thinkSupported = false
          res = await send(false)
        }
        if (!res.ok) {
          const retryBody = res.bodyUsed ? '' : await res.text().catch(() => '')
          const retryReason = extractOllamaError(safeParse(retryBody)) ?? retryBody.trim() ?? ''
          const said = thinkSupported ? reason : retryReason || reason
          throw new Error(`ollama returned HTTP ${res.status}${said ? `: ${said}` : ''}`)
        }
      }
      if (!res.body) throw new Error('ollama returned no response body')

      const gate = createThinkGate()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let carry = ''

      for (;;) {
        let chunk: { done: boolean; value?: Uint8Array }
        try {
          chunk = await reader.read()
        } catch (error) {
          if (timedOut) throw new OllamaTimeoutError(timeoutMs, host, model)
          throw error
        }
        if (chunk.done) break
        arm()

        const fed = feedLines(carry, decoder.decode(chunk.value, { stream: true }))
        carry = fed.carry
        for (const line of fed.lines) {
          const text = consume(line, gate)
          if (text) yield text
        }
      }

      if (carry.trim() !== '') {
        const text = consume(carry, gate)
        if (text) yield text
      }

      const tail = gate.flush()
      if (tail) yield tail
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * One NDJSON line to speakable text.
 *
 * An unparsable line is logged rather than swallowed, matching the claude
 * transport: the entire point of this output is to be heard, so silently
 * dropping model text is the worst available failure.
 */
function consume(line: string, gate: ThinkGate): string {
  if (line.trim() === '') return ''
  const parsed = safeParse(line)
  if (parsed === null) {
    console.error(`ollamaStream: dropping an unparsable NDJSON line: ${line}`)
    return ''
  }
  const error = extractOllamaError(parsed)
  if (error !== null) throw new Error(`ollama reported an error: ${error}`)
  const delta = extractOllamaDelta(parsed)
  if (delta === null) return ''
  return gate.push(delta)
}
