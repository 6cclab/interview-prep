import { describe, it, expect } from 'vitest'
import {
  normaliseBaseUrl,
  openaiChatBody,
  extractOpenaiDelta,
  extractOpenaiError,
  parseSseLine,
  DEFAULT_OPENAI_BASE_URL,
  openaiStream,
  OpenAIConfigError,
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
  // pointing this at a local vLLM will write it the same way. Loopback is the
  // only case where a scheme-less default is safe to assume http for — see the
  // non-loopback cases below.
  it('assumes http for a bare loopback host:port', () => {
    expect(normaliseBaseUrl('localhost:8000/v1')).toBe('http://localhost:8000/v1')
    expect(normaliseBaseUrl('127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1')
    expect(normaliseBaseUrl('[::1]:8000/v1')).toBe('http://[::1]:8000/v1')
  })

  // A scheme-less non-loopback host is about to carry a bearer token, so
  // guessing http would silently ship the key in the clear. https is the safe
  // assumption; a real deployment wanting plain http has to say so explicitly
  // and accept the throw below.
  it('assumes https for a bare non-loopback host', () => {
    expect(normaliseBaseUrl('api.myproxy.com/v1')).toBe('https://api.myproxy.com/v1')
  })

  // An explicit http:// to a non-loopback host is unambiguous: someone asked
  // to send the API key in cleartext. Refuse rather than comply.
  it('refuses an explicit http to a non-loopback host', () => {
    expect(() => normaliseBaseUrl('http://api.myproxy.com/v1')).toThrow(/cleartext/i)
  })

  it('still allows explicit http to loopback', () => {
    expect(normaliseBaseUrl('http://localhost:8000/v1')).toBe('http://localhost:8000/v1')
    expect(normaliseBaseUrl('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1')
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

/** An SSE response built from lines, so a test can split chunks where it likes. */
function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

async function collect(iterable: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const piece of iterable) out += piece
  return out
}

describe('openaiStream', () => {
  it('refuses to start without a key rather than failing mid-drill', () => {
    expect(() => openaiStream({ apiKey: '' })).toThrow(OpenAIConfigError)
    expect(() => openaiStream({ apiKey: '' })).toThrow(/OPENAI_API_KEY/)
  })

  it('sends the key as a bearer token to the configured base URL', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const stream = openaiStream({
      apiKey: 'k',
      baseUrl: 'https://example.test/v1',
      model: 'm',
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenAuth = String((init?.headers as Record<string, string>).authorization)
        return sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n'])
      },
    })
    await collect(stream('SYSTEM', []))
    expect(seenUrl).toBe('https://example.test/v1/chat/completions')
    expect(seenAuth).toBe('Bearer k')
  })

  it('yields content across chunk boundaries that split a line', async () => {
    const stream = openaiStream({
      apiKey: 'k',
      fetchImpl: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"con',
          'tent":"hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
    })
    expect(await collect(stream('SYSTEM', []))).toBe('hello world')
  })

  // Case 2 of the think gate: deliberation arrives as ordinary content and is
  // terminated by a bare closing tag. On the coding track that text states what
  // the model believes the answer is, so it must never reach the speaker.
  it('withholds deliberation emitted as content', async () => {
    const stream = openaiStream({
      apiKey: 'k',
      fetchImpl: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"The answer is two pointers.</think>"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"What is your first approach?"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
    })
    expect(await collect(stream('SYSTEM', []))).toBe('What is your first approach?')
  })

  it('names the provider error on a non-200', async () => {
    const stream = openaiStream({
      apiKey: 'k',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }),
    })
    await expect(collect(stream('SYSTEM', []))).rejects.toThrow(/404.*model not found/s)
  })

  it('throws on an error delivered inside the stream', async () => {
    const stream = openaiStream({
      apiKey: 'k',
      fetchImpl: async () => sseResponse(['data: {"error":{"message":"context length"}}\n\n']),
    })
    await expect(collect(stream('SYSTEM', []))).rejects.toThrow(/context length/)
  })
})
