import { useCallback, useRef, useState } from 'react'

/**
 * The practice tutor, client side.
 *
 * The whole conversation lives here, in the browser, and is posted back in full
 * on every question. That is not a shortcut around persistence — practice has no
 * session on the server to attach a conversation to, deliberately, and giving it
 * one would mean an idle reaper and a lifecycle for something whose natural
 * lifetime is "this tab".
 *
 * It does mean the history is forgeable: someone can claim the tutor said
 * anything. Nothing here is scored, so the only person that deceives is the
 * person doing it — the same reasoning the browser-computed verdict already
 * accepts rather than defends against.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PracticeChat {
  messages: ChatMessage[]
  /** True from the moment a question is sent until the reply finishes or fails. */
  streaming: boolean
  /** Sends a question. Ignored while one is already in flight. */
  ask(question: string): void
  /** Abandons the reply in progress. The partial answer stays on screen. */
  stop(): void
}

/**
 * `send` is injected so a test can drive this without a server. It returns the
 * response body as a stream of text chunks, which is what the route emits —
 * plain chunked text rather than SSE, because `EventSource` cannot POST and one
 * continuous reply has no event types to frame.
 */
export type ChatSend = (
  body: { problem: string; code: string; messages: ChatMessage[] },
  signal: AbortSignal,
) => Promise<AsyncIterable<string>>

export const postChat: ChatSend = async (body, signal) => {
  const res = await fetch('/api/practice/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || res.body === null) {
    // The status is the only place a failure can be reported — everything that
    // can fail server-side does so before the first byte, on purpose.
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `the tutor could not be reached (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield decoder.decode(value, { stream: true })
      }
    },
  }
}

/**
 * The conversation as data, so the parts that can be wrong are testable.
 *
 * `voice/web` has no jsdom and no testing-library, on purpose — the web spec's
 * "zero new dependencies" covers the test stack too. So the logic that decides
 * what a conversation looks like lives in these three pure functions, and the
 * hook below is the thin React glue over them. Everything that has ever been
 * wrong here — a delta appended to the wrong turn, a placeholder reply sent
 * back to the server as history, an error replacing a partial answer instead of
 * following it — is a property of one of these.
 */

/** The history the server is sent: every finished turn, plus the new question. */
export function historyFor(messages: ChatMessage[], question: string): ChatMessage[] {
  return [...messages, { role: 'user', content: question }]
}

/**
 * Appends a streamed delta to the reply in progress.
 *
 * Returns the list unchanged if the last turn is not an assistant's — which
 * means the conversation moved on underneath a stream that should already have
 * been aborted, and appending would write one reply into another's turn.
 */
export function appendDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return messages
  const next = [...messages]
  next[next.length - 1] = { role: 'assistant', content: last.content + delta }
  return next
}

/**
 * Marks the reply in progress as failed, keeping whatever arrived first.
 *
 * The note goes inside the turn rather than into a banner: the failure belongs
 * to one question, and a banner floating above a conversation does not say
 * which turn it is about.
 */
export function withFailure(messages: ChatMessage[], detail: string): ChatMessage[] {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return messages
  const next = [...messages]
  next[next.length - 1] = {
    role: 'assistant',
    content: `${last.content}\n\n_The tutor could not answer: ${detail}_`,
  }
  return next
}

export function usePracticeChat(
  problem: string,
  /** Read at send time rather than captured, so the buffer sent is the one on screen. */
  currentCode: () => string,
  send: ChatSend = postChat,
): PracticeChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim()
      if (trimmed === '' || abortRef.current !== null) return

      // The user's turn goes up immediately, before any network. A question that
      // vanishes from the box and appears half a second later reads as the send
      // having failed, and invites a second press.
      const history = historyFor(messages, trimmed)
      setMessages([...history, { role: 'assistant', content: '' }])
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      void (async () => {
        try {
          const stream = await send(
            { problem, code: currentCode(), messages: history },
            controller.signal,
          )
          for await (const delta of stream) {
            if (controller.signal.aborted) return
            // Appends to the last message rather than rebuilding the list, so a
            // long reply does not re-render every earlier turn per chunk.
            setMessages((current) => appendDelta(current, delta))
          }
        } catch (error) {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          // Written into the reply itself rather than a separate error banner:
          // the failure belongs to this question, and a banner floating above a
          // conversation does not say which turn it is about.
          setMessages((current) => withFailure(current, message))
        } finally {
          if (abortRef.current === controller) abortRef.current = null
          setStreaming(false)
        }
      })()
    },
    [messages, problem, currentCode, send],
  )

  return { messages, streaming, ask, stop }
}
