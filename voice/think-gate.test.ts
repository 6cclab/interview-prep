import { describe, it, expect } from 'vitest'
import { createThinkGate } from './think-gate'

describe('createThinkGate', () => {
  // This is the shape actually measured against ollama 0.24.0 with
  // `think: false`: deliberation as plain content, no opening tag, terminated
  // by a bare `</think>`. Unfiltered it is spoken aloud, and on the coding
  // track the deliberation states the answer.
  it('drops unopened deliberation terminated by a bare </think>', () => {
    const gate = createThinkGate()
    let spoken = ''
    spoken += gate.push({ content: 'Okay, the candidate mentioned using a hash map. ', thinking: false })
    spoken += gate.push({ content: 'Let me ask about collisions.\n</think>\n\n', thinking: false })
    spoken += gate.push({ content: 'How does a hash map handle collisions?', thinking: false })
    spoken += gate.flush()
    expect(spoken.trim()).toBe('How does a hash map handle collisions?')
    expect(spoken).not.toMatch(/hash map handle collisions\?[\s\S]*candidate mentioned/)
    expect(spoken).not.toContain('Okay')
  })

  it('drops a properly paired <think> block too', () => {
    const gate = createThinkGate()
    let spoken = ''
    spoken += gate.push({ content: '<think>The answer is a hash set.</think>', thinking: false })
    spoken += gate.push({ content: 'What does that cost you?', thinking: false })
    spoken += gate.flush()
    expect(spoken.trim()).toBe('What does that cost you?')
    expect(spoken).not.toContain('hash set')
  })

  // The tag can be split across two deltas, because a token boundary is not a
  // tag boundary. Scanning the accumulated buffer rather than each delta is
  // what makes this work.
  it('finds the closing tag when it is split across deltas', () => {
    const gate = createThinkGate()
    let spoken = ''
    spoken += gate.push({ content: 'thinking aloud </thi', thinking: false })
    spoken += gate.push({ content: 'nk> The real question.', thinking: false })
    spoken += gate.flush()
    expect(spoken.trim()).toBe('The real question.')
  })

  // Case 3: no marker ever arrives, so nothing can distinguish "this model
  // does not think" from "the marker has not come yet" mid-stream. Holding to
  // the end costs the streaming; speaking early risks the answer.
  it('releases the whole reply at flush when no marker ever arrives', () => {
    const gate = createThinkGate()
    expect(gate.push({ content: 'What does ', thinking: false })).toBe('')
    expect(gate.push({ content: 'that cost?', thinking: false })).toBe('')
    expect(gate.flush()).toBe('What does that cost?')
  })

  // Case 1: a newer server puts deliberation in its own field, which proves
  // `content` is clean — so the gate can open and stream from then on.
  it('streams immediately once a separate thinking field proves content is clean', () => {
    const gate = createThinkGate()
    expect(gate.push({ content: '', thinking: true })).toBe('')
    expect(gate.push({ content: 'One question ', thinking: false })).toBe('One question ')
    expect(gate.push({ content: 'at a time.', thinking: false })).toBe('at a time.')
    expect(gate.flush()).toBe('')
  })

  it('releases content already buffered when the thinking field appears late', () => {
    const gate = createThinkGate()
    expect(gate.push({ content: 'Held. ', thinking: false })).toBe('')
    expect(gate.push({ content: '', thinking: true })).toBe('Held. ')
  })

  // An unterminated `<think>` is deliberation that was cut off — releasing it
  // would speak exactly what the gate exists to suppress.
  it('does not release an unterminated <think> block at flush', () => {
    const gate = createThinkGate()
    expect(gate.push({ content: '<think>The answer is a hash set and I', thinking: false })).toBe('')
    expect(gate.flush()).toBe('')
  })

  it('emits nothing for empty deltas', () => {
    const gate = createThinkGate()
    expect(gate.push({ content: '', thinking: false })).toBe('')
    expect(gate.flush()).toBe('')
  })
})
