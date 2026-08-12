import type Anthropic from '@anthropic-ai/sdk'
import { SentenceBuffer } from './chunk'
import { speechText } from './reply-code'

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
 * A fence opens with a backtick run that the sentence chunker would happily
 * speak, so nothing inside one may reach the synthesiser — not a `drill-log`
 * trailer, not a code block. `speechText` does that removal; this constant is
 * how much of the tail is withheld while a fence might still be arriving.
 *
 * Two characters, because "``" is the longest prefix of a fence that is not yet
 * a fence. Withholding it means the backticks are never spoken in the delta
 * before the one that completes them.
 */
const FENCE_HOLDBACK = 2

export function createInterviewer(system: string, stream: StreamFn): Interviewer {
  const messages: Message[] = []
  let raw = ''

  return {
    async *turn(said: string): AsyncIterable<string> {
      messages.push({ role: 'user', content: said })
      const buffer = new SentenceBuffer()
      raw = ''
      // How much of `speechText(raw)` has already gone to the chunker. Tracking
      // a length into the projection — rather than a fence flag — is what lets a
      // fence *end*: prose after the closing fence simply extends the projection
      // and gets spoken, so the pairing coach can show a snippet mid-turn and
      // keep talking. The previous flag sealed the rest of the turn permanently.
      let spoken = 0

      try {
        for await (const delta of stream(system, messages)) {
          raw += delta
          const prose = speechText(raw)
          // The projection can shrink by up to a fence's length as a backtick
          // run resolves into an opener, so this can go backwards; the guard is
          // what keeps that from re-speaking or slicing negatively.
          const safe = prose.length - FENCE_HOLDBACK
          if (safe > spoken) {
            for (const sentence of buffer.push(prose.slice(spoken, safe))) yield sentence
            spoken = safe
          }
        }

        // The stream is done, so nothing more can turn a trailing backtick run
        // into a fence. Release the held-back tail.
        const prose = speechText(raw)
        if (prose.length > spoken) {
          for (const sentence of buffer.push(prose.slice(spoken))) yield sentence
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
