/**
 * One text delta from a model stream, and whether the server marked it as
 * deliberation rather than answer.
 *
 * Shared by every transport rather than living with one: the failure it exists
 * for is a property of reasoning models, not of ollama. A model served by vLLM
 * or LM Studio over an OpenAI-compatible endpoint emits deliberation into
 * `content` exactly as the local measurements in `voice/ollama.ts` recorded.
 */
export interface ModelDelta {
  content: string
  thinking: boolean
}

const CLOSE_THINK = '</think>'

export interface ThinkGate {
  /** Text safe to speak, given everything pushed so far. May be empty. */
  push(delta: ModelDelta): string
  /** Called once the stream ends. Releases anything still held back. */
  flush(): string
}

/**
 * Holds output back until it is known not to be the model thinking out loud.
 *
 * Three cases, and the gate cannot tell them apart in advance:
 *
 * 1. The server separates deliberation into `message.thinking`. Then `content`
 *    is already clean and can stream immediately — the first `thinking` delta
 *    is the proof, and it opens the gate for good.
 * 2. The model emits its deliberation as `content`, ending in `</think>`
 *    (measured, with no opening tag). Everything up to and including that tag
 *    is dropped; everything after it streams.
 * 3. The model never thinks at all, so no `</think>` ever arrives. Nothing can
 *    distinguish this from case 2 mid-stream, so the whole reply is held and
 *    released by `flush`.
 *
 * Case 3 costs the streaming: at 51 tok/s a ~300 token reply means the speaker
 * stays silent for about six seconds after the turn is submitted. That is the
 * right trade — the alternative is a chance of reading the answer aloud — and
 * the client already renders a `thinking` phase, so the silence is displayed
 * rather than mysterious.
 *
 * An opening `<think>` is stripped too, for the properly-paired case, but is
 * never used as the trigger: the measured output had no opening tag at all, so
 * treating its absence as "this model does not think" would have leaked.
 */
export function createThinkGate(): ThinkGate {
  let open = false
  let held = ''

  return {
    push(delta: ModelDelta): string {
      if (delta.thinking) {
        // Case 1. Deliberation is arriving in its own field, so whatever is
        // already held is real content and safe to release.
        open = true
        const release = held
        held = ''
        return release
      }
      if (delta.content === '') return ''
      if (open) return delta.content

      held += delta.content
      const at = held.indexOf(CLOSE_THINK)
      if (at === -1) return ''

      // Case 2. Drop the thinking and the tag; keep the tail.
      open = true
      const tail = held.slice(at + CLOSE_THINK.length)
      held = ''
      return tail
    },

    flush(): string {
      // Case 3. Nothing marked the end of thinking, so this was never thinking.
      const release = held
      held = ''
      if (!open) {
        const trimmed = release.trimStart()
        return trimmed.startsWith('<think>') ? '' : release
      }
      return release
    },
  }
}
