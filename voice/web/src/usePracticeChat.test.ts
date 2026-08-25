import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendDelta, historyFor, withFailure, type ChatMessage } from './usePracticeChat'

/**
 * The tutor's conversation, client side.
 *
 * The server holds none of this — practice has no session — so everything about
 * how a conversation accumulates and fails is decided in the browser. There is
 * no jsdom here (the web client's "zero new dependencies" covers the test stack
 * too), so the logic lives in pure functions and the React glue over them is
 * checked as source text.
 */

const REPLYING: ChatMessage[] = [
  { role: 'user', content: 'why is this slow?' },
  { role: 'assistant', content: 'Because ' },
]

describe('historyFor', () => {
  /**
   * The placeholder assistant turn the UI puts on screen must not be sent back
   * as history — the server refuses a conversation that does not end with the
   * learner, and rightly: answering one would have the model reply to itself.
   */
  it('ends with the new question', () => {
    const history = historyFor([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'c')
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(history.at(-1)?.content).toBe('c')
  })

  it('does not mutate the conversation it was given', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'a' }]
    historyFor(messages, 'b')
    expect(messages).toHaveLength(1)
  })
})

describe('appendDelta', () => {
  it('accumulates a streamed reply into the turn in progress', () => {
    let messages = REPLYING
    for (const delta of ['the loop ', 'is nested.']) messages = appendDelta(messages, delta)
    expect(messages).toHaveLength(2)
    expect(messages[1]?.content).toBe('Because the loop is nested.')
  })

  /**
   * If the last turn is not an assistant's, the conversation moved on beneath a
   * stream that should already have been aborted. Appending would write one
   * reply into another question's turn — visible as the tutor answering the
   * wrong thing, which is far harder to diagnose than a dropped chunk.
   */
  it('refuses to write into a turn that is not a reply in progress', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'a new question' }]
    expect(appendDelta(messages, 'stray')).toBe(messages)
  })

  it('does not mutate the conversation it was given', () => {
    appendDelta(REPLYING, 'more')
    expect(REPLYING[1]?.content).toBe('Because ')
  })
})

describe('withFailure', () => {
  // Whatever arrived before the failure is worth keeping: half an explanation
  // is still half an explanation, and deleting it hides that the tutor started.
  it('keeps the partial answer and adds why it stopped', () => {
    const failed = withFailure(REPLYING, 'the tutor could not be reached (503)')
    expect(failed[1]?.content).toContain('Because ')
    expect(failed[1]?.content).toContain('503')
  })

  it('stays inside the assistant turn rather than adding one', () => {
    expect(withFailure(REPLYING, 'nope')).toHaveLength(2)
    expect(withFailure(REPLYING, 'nope')[1]?.role).toBe('assistant')
  })
})

/**
 * The React glue, read as source.
 *
 * Three properties that no pure function can carry, each of which was a real
 * decision rather than an accident.
 */
describe('the hook', () => {
  const source = readFileSync(join(import.meta.dirname, 'usePracticeChat.ts'), 'utf8')

  // A second press while a reply streams would interleave two replies into one
  // turn, because both append to the last entry.
  it('refuses a second question while one is in flight', () => {
    expect(source).toMatch(/abortRef\.current !== null\) return/)
  })

  // The buffer is read at send time, not captured when the handler was made,
  // so the tutor is asked about the code as it is now.
  it('reads the buffer at send time', () => {
    expect(source).toContain('code: currentCode()')
  })

  // An aborted stream must stop appending. Without this the "Stop" button
  // leaves the reply still growing behind it.
  it('stops appending once aborted', () => {
    expect(source).toMatch(/signal\.aborted\) return/)
  })
})
