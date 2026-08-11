import type { Message } from './interviewer'
import type { ModelDelta } from './think-gate'
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
 * A bare `host:port` is accepted as well as a URL, because `OLLAMA_HOST`
 * accepts one and someone pointing this at a local vLLM will write it the same
 * way. Trailing slashes are stripped so path joining cannot double them.
 */
export function normaliseBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_OPENAI_BASE_URL
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`
  return withScheme.replace(/\/+$/, '')
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
