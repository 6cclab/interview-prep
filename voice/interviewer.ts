import type Anthropic from '@anthropic-ai/sdk'
import { SentenceBuffer } from './chunk'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** Yields text deltas. Injectable so the loop is testable without an API key. */
export type StreamFn = (system: string, messages: Message[]) => AsyncIterable<string>

export interface Interviewer {
  /** Feed what Andre said; yields the reply one speakable sentence at a time. */
  turn(said: string): AsyncIterable<string>
  /** The last reply in full, trailer included. */
  lastRaw(): string
}

/**
 * The trailer is a fenced block, and a fence opens with a backtick run that the
 * sentence chunker would happily speak. Hold output back once a fence starts.
 */
const FENCE = '```'

export function createInterviewer(system: string, stream: StreamFn): Interviewer {
  const messages: Message[] = []
  let raw = ''

  return {
    async *turn(said: string): AsyncIterable<string> {
      messages.push({ role: 'user', content: said })
      const buffer = new SentenceBuffer()
      raw = ''
      let fenced = false
      let carry = ''
      const holdback = FENCE.length - 1

      try {
        for await (const delta of stream(system, messages)) {
          raw += delta
          if (fenced) continue

          const text = carry + delta
          const fenceAt = text.indexOf(FENCE)
          if (fenceAt !== -1) {
            fenced = true
            carry = ''
            for (const sentence of buffer.push(text.slice(0, fenceAt))) yield sentence
            continue
          }

          if (text.length < holdback) {
            carry = text
            continue
          }

          carry = text.slice(text.length - holdback)
          for (const sentence of buffer.push(text.slice(0, text.length - holdback))) yield sentence
        }

        if (!fenced && carry) {
          for (const sentence of buffer.push(carry)) yield sentence
        }

        for (const sentence of buffer.flush()) yield sentence

        if (raw.trim() === '') {
          throw new Error('the interviewer returned nothing')
        }

        messages.push({ role: 'assistant', content: raw })
      } catch (error) {
        messages.pop()
        throw error
      }
    },

    lastRaw(): string {
      return raw
    },
  }
}

/**
 * The real stream. No `thinking` parameter: adaptive thinking is the default on
 * the Claude 5 models, and `max_tokens` bounds thinking plus response text
 * together. Effort is `medium` because the interviewer's job is one good
 * question and then silence — lower effort means less preamble, which is
 * exactly the brief.
 *
 * The model is a parameter so this path and the CLI path can be pointed at the
 * same tier from one place; see `DEFAULT_MODEL` in `claude-cli.ts` for why the
 * default is Sonnet rather than Opus.
 */
export function anthropicStream(client: Anthropic, model = 'claude-sonnet-5'): StreamFn {
  return async function* (system, messages) {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system,
      messages,
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
