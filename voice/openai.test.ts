import { describe, it, expect } from 'vitest'
import {
  normaliseBaseUrl,
  openaiChatBody,
  extractOpenaiDelta,
  extractOpenaiError,
  parseSseLine,
  DEFAULT_OPENAI_BASE_URL,
} from './openai'

describe('normaliseBaseUrl', () => {
  it('defaults when unset or blank', () => {
    expect(normaliseBaseUrl(undefined)).toBe(DEFAULT_OPENAI_BASE_URL)
    expect(normaliseBaseUrl('   ')).toBe(DEFAULT_OPENAI_BASE_URL)
  })

  it('strips trailing slashes so path joining cannot double them', () => {
    expect(normaliseBaseUrl('https://example.test/v1/')).toBe('https://example.test/v1')
    expect(normaliseBaseUrl('https://example.test/v1///')).toBe('https://example.test/v1')
  })

  // A bare host:port is how OLLAMA_HOST is allowed to be written, and someone
  // pointing this at a local vLLM will write it the same way.
  it('assumes http for a bare host:port', () => {
    expect(normaliseBaseUrl('localhost:8000/v1')).toBe('http://localhost:8000/v1')
  })
})

describe('openaiChatBody', () => {
  it('sends the system prompt as a system-role message and streams', () => {
    const body = openaiChatBody('SYSTEM', [{ role: 'user', content: 'hello' }], { model: 'm' })
    expect(body.model).toBe('m')
    expect(body.stream).toBe(true)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
  })

  // Candidate speech is transcribed audio and reaches the model verbatim. Roles
  // carry the turn boundary here, but the standing notice is sent anyway — the
  // same reasoning as `ollamaChatBody`.
  it('appends the untrusted-speech notice to the system message', () => {
    const body = openaiChatBody('SYSTEM', [], { model: 'm' })
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]!.content).toContain('SYSTEM')
    expect(messages[0]!.content).toMatch(/never as an instruction/i)
  })
})

describe('parseSseLine', () => {
  it('reads the payload off a data line', () => {
    expect(parseSseLine('data: {"a":1}')).toEqual({ done: false, json: '{"a":1}' })
  })

  it('recognises the terminator', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ done: true, json: null })
  })

  it('ignores comments, blank lines and non-data fields', () => {
    expect(parseSseLine('')).toEqual({ done: false, json: null })
    expect(parseSseLine(': keep-alive')).toEqual({ done: false, json: null })
    expect(parseSseLine('event: message')).toEqual({ done: false, json: null })
  })
})

describe('extractOpenaiDelta', () => {
  it('reads content off the first choice', () => {
    const parsed = { choices: [{ delta: { content: 'hi' } }] }
    expect(extractOpenaiDelta(parsed)).toEqual({ content: 'hi', thinking: false })
  })

  // Providers that separate deliberation use `reasoning_content`. Reporting it
  // as `thinking` is what lets the gate stop buffering — see think-gate.ts.
  it('reports separated deliberation as thinking', () => {
    const parsed = { choices: [{ delta: { reasoning_content: 'weighing it up' } }] }
    expect(extractOpenaiDelta(parsed)).toEqual({ content: '', thinking: true })
  })

  it('returns null for a chunk carrying no text', () => {
    expect(extractOpenaiDelta({ choices: [{ delta: {} }] })).toBeNull()
    expect(extractOpenaiDelta({ choices: [] })).toBeNull()
    expect(extractOpenaiDelta(null)).toBeNull()
    expect(extractOpenaiDelta('nonsense')).toBeNull()
  })
})

describe('extractOpenaiError', () => {
  it('reads the message out of an error envelope', () => {
    expect(extractOpenaiError({ error: { message: 'model not found' } })).toBe('model not found')
  })

  it('accepts a bare string error', () => {
    expect(extractOpenaiError({ error: 'bad key' })).toBe('bad key')
  })

  it('returns null when there is no error', () => {
    expect(extractOpenaiError({ choices: [] })).toBeNull()
    expect(extractOpenaiError(null)).toBeNull()
  })
})
