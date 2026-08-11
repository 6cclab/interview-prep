import type { Message, StreamFn } from './interviewer'
import { createThinkGate, type ModelDelta, type ThinkGate } from './think-gate'
import { UNTRUSTED_NOTICE } from './prompt-framing'

/**
 * Any endpoint speaking OpenAI's `/v1/chat/completions`.
 *
 * One adapter rather than one per vendor: OpenAI, Azure OpenAI, Groq, together,
 * vLLM and LM Studio all serve this shape, so the vendor is a base URL rather
 * than a code path. That is the whole reason this module exists — the repo had
 * three backends and two of them were Anthropic.
 *
 * Not folded into `voice/ollama.ts`: ollama streams NDJSON and this streams
 * SSE, so the transport loops share nothing but the think gate, which Task 1
 * moved somewhere both can reach.
 */

/** Overridable — this is the only vendor named anywhere in the module. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export const DEFAULT_OPENAI_MODEL = 'gpt-4.1'

/**
 * Bounds silence, not total duration. Consumed by `openaiStream` (Task 3);
 * declared here because it belongs beside `OpenAIOptions.timeoutMs`, whose doc
 * comment refers to it as the default.
 */
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000

export interface OpenAIOptions {
  /** Defaults to `OPENAI_BASE_URL`, then `DEFAULT_OPENAI_BASE_URL`. */
  baseUrl?: string
  /** Defaults to `OPENAI_MODEL`, then `DEFAULT_OPENAI_MODEL`. */
  model?: string
  /** Defaults to `OPENAI_API_KEY`. Absent is a startup error, not a fallback. */
  apiKey?: string
  timeoutMs?: number
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch
}

/**
 * A misconfiguration that must stop the server rather than a drill.
 *
 * Thrown from `normaliseBaseUrl` (a cleartext-credential base URL) and from
 * `openaiStream` at construction (a missing key), which `streamForBackend`
 * calls at session creation — so either is a failure to start a session with
 * a message naming the problem, not a 45-minute drill that dies on turn one.
 */
export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAIConfigError'
  }
}

/** Hosts exempt from the cleartext rule below — nothing leaves the machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLoopbackHost(hostAndRest: string): boolean {
  // Strip a port and/or path, and any brackets an IPv6 literal carries, to get
  // at the bare host for the comparison above.
  const host = hostAndRest.replace(/^\[/, '').replace(/\]?(:\d+)?(\/.*)?$/, '')
  return LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(`[${host}]`)
}

/**
 * A bare `host:port` is accepted as well as a URL, because `OLLAMA_HOST`
 * accepts one and someone pointing this at a local vLLM will write it the same
 * way. Trailing slashes are stripped so path joining cannot double them.
 *
 * The scheme resolution is a security decision, not a convenience one:
 * `openaiStream` attaches the API key as an `Authorization: Bearer` header, so
 * whatever scheme this function hands back is what the key travels over.
 *
 * - A scheme-less loopback host (`localhost`, `127.0.0.1`, `::1`) defaults to
 *   `http://` — the local vLLM / LM Studio case, where nothing leaves the
 *   machine and there is no real key at risk.
 * - A scheme-less non-loopback host defaults to `https://` instead of
 *   guessing `http://`, so a typo'd base URL cannot silently ship a key in
 *   the clear.
 * - An explicit `http://` to a non-loopback host is refused outright: that is
 *   not a guess, it is a request to send a credential over cleartext, and the
 *   only correct response is to say so before the first request goes out.
 */
export function normaliseBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_OPENAI_BASE_URL

  const hasScheme = /^https?:\/\//i.test(value)
  if (hasScheme) {
    const isHttp = /^http:\/\//i.test(value)
    const rest = value.replace(/^https?:\/\//i, '')
    if (isHttp && !isLoopbackHost(rest)) {
      throw new OpenAIConfigError(
        `refusing to use http:// for a non-loopback base URL (${value}): the API ` +
          `key would travel in cleartext. Use https://, or point at localhost / ` +
          `127.0.0.1 / ::1 if this really is a local endpoint.`,
      )
    }
    return value.replace(/\/+$/, '')
  }

  const scheme = isLoopbackHost(value) ? 'http://' : 'https://'
  return `${scheme}${value}`.replace(/\/+$/, '')
}

/**
 * The `/v1/chat/completions` request body.
 *
 * Deliberately minimal: no temperature, no max_tokens, no penalties. Every
 * provider defaults those sensibly and pinning them here would mean tuning
 * them per provider, which is the coupling this module exists to avoid.
 */
export function openaiChatBody(
  system: string,
  messages: Message[],
  opts: { model: string },
): Record<string, unknown> {
  return {
    model: opts.model,
    stream: true,
    messages: [
      { role: 'system', content: `${system}\n\n${UNTRUSTED_NOTICE}` },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  }
}

/**
 * One SSE line to its JSON payload.
 *
 * `data: [DONE]` is a sentinel rather than JSON, so it is reported separately —
 * parsing it would log a spurious "unparsable chunk" on every clean stream.
 */
export function parseSseLine(line: string): { done: boolean; json: string | null } {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith(':')) return { done: false, json: null }
  if (!trimmed.startsWith('data:')) return { done: false, json: null }
  const payload = trimmed.slice('data:'.length).trim()
  if (payload === '[DONE]') return { done: true, json: null }
  return { done: false, json: payload }
}

/**
 * Narrows one parsed chunk to its text, or null.
 *
 * `reasoning_content` is reported as `thinking` rather than merged into
 * `content`: a server populating it is one keeping deliberation out of
 * `content`, and that fact is what lets the think gate stop buffering.
 */
export function extractOpenaiDelta(parsed: unknown): ModelDelta | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const chunk = parsed as { choices?: unknown }
  if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) return null
  const first = chunk.choices[0] as { delta?: { content?: unknown; reasoning_content?: unknown } }
  const delta = first?.delta
  if (typeof delta !== 'object' || delta === null) return null
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
    return { content: '', thinking: true }
  }
  if (typeof delta.content !== 'string') return null
  return { content: delta.content, thinking: false }
}

/** Reads an error envelope, in either the object or bare-string form providers use. */
export function extractOpenaiError(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const body = parsed as { error?: unknown }
  if (typeof body.error === 'string' && body.error !== '') return body.error
  if (typeof body.error === 'object' && body.error !== null) {
    const message = (body.error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return null
}

export function openaiStream(opts: OpenAIOptions = {}): StreamFn {
  const baseUrl = normaliseBaseUrl(opts.baseUrl ?? process.env.OPENAI_BASE_URL)
  const model = opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? ''
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = opts.fetchImpl ?? fetch

  if (apiKey.trim() === '') {
    throw new OpenAIConfigError(
      `OPENAI_API_KEY is not set, and the openai backend cannot run without it. ` +
        `Set it, or choose another backend (pnpm mock:web:claude / :ollama). ` +
        `Base URL in use: ${baseUrl}`,
    )
  }

  return async function* (system, messages) {
    const controller = new AbortController()
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
      let res: Response
      try {
        res = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(openaiChatBody(system, messages, { model })),
          signal: controller.signal,
        })
      } catch (error) {
        if (timedOut) {
          throw new Error(`${baseUrl} produced no output for ${timeoutMs}ms and the request was aborted.`)
        }
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`could not reach ${baseUrl}: ${detail}`)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const reason = extractOpenaiError(safeParse(body)) ?? body.trim()
        throw new Error(`${baseUrl} returned HTTP ${res.status}${reason ? `: ${reason}` : ''}`)
      }
      if (!res.body) throw new Error(`${baseUrl} returned no response body`)

      const gate = createThinkGate()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let carry = ''

      for (;;) {
        let chunk: { done: boolean; value?: Uint8Array }
        try {
          chunk = await reader.read()
        } catch (error) {
          if (timedOut) {
            throw new Error(`${baseUrl} stopped producing output for ${timeoutMs}ms.`)
          }
          throw error
        }
        if (chunk.done) break
        arm()

        carry += decoder.decode(chunk.value, { stream: true })
        const lines = carry.split('\n')
        carry = lines.pop() ?? ''
        for (const line of lines) {
          const text = consumeSse(line, gate)
          if (text) yield text
        }
      }

      if (carry.trim() !== '') {
        const text = consumeSse(carry, gate)
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
 * One SSE line to speakable text.
 *
 * An unparsable payload is logged rather than swallowed, matching both other
 * transports: the entire point of this output is to be heard, so silently
 * dropping model text is the worst available failure.
 */
function consumeSse(line: string, gate: ThinkGate): string {
  const { done, json } = parseSseLine(line)
  if (done || json === null) return ''
  const parsed = safeParse(json)
  if (parsed === null) {
    console.error(`openaiStream: dropping an unparsable SSE payload: ${json}`)
    return ''
  }
  const error = extractOpenaiError(parsed)
  if (error !== null) throw new Error(`the provider reported an error: ${error}`)
  const delta = extractOpenaiDelta(parsed)
  if (delta === null) return ''
  return gate.push(delta)
}
