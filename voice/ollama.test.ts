import { describe, expect, it, vi } from 'vitest'
import {
  createThinkGate,
  extractOllamaDelta,
  extractOllamaError,
  normaliseHost,
  ollamaChatBody,
  ollamaStream,
  preloadOllama,
} from './ollama'

/** Collects a `StreamFn`'s yields. */
async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const piece of iterable) out.push(piece)
  return out
}

/**
 * A `fetch` stand-in that streams the given NDJSON lines, split into chunks at
 * arbitrary byte boundaries so the line-buffering is genuinely exercised
 * rather than handed one tidy line at a time.
 */
function fakeFetch(lines: string[], opts: { chunkSize?: number; status?: number } = {}) {
  const body = lines.map((l) => `${l}\n`).join('')
  const chunkSize = opts.chunkSize ?? 7
  const calls: Array<{ url: string; body: unknown }> = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) })
    const bytes = new TextEncoder().encode(body)
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize))
        offset += chunkSize
      },
    })
    return new Response(stream, { status: opts.status ?? 200 })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

function contentLine(text: string): string {
  return JSON.stringify({ model: 'm', message: { role: 'assistant', content: text }, done: false })
}

const DONE_LINE = JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true })

describe('normaliseHost', () => {
  it('falls back to ollama’s own default when unset or blank', () => {
    expect(normaliseHost(undefined)).toBe('http://127.0.0.1:11434')
    expect(normaliseHost('  ')).toBe('http://127.0.0.1:11434')
  })

  it('passes a URL through, minus any trailing slash', () => {
    expect(normaliseHost('http://192.168.3.168:11434')).toBe('http://192.168.3.168:11434')
    expect(normaliseHost('http://192.168.3.168:11434/')).toBe('http://192.168.3.168:11434')
    expect(normaliseHost('https://ollama.example.com')).toBe('https://ollama.example.com')
  })

  // `OLLAMA_HOST=192.168.3.168:11434` is valid for ollama's own CLI, so a
  // working shell config must not break when this code reads the same variable.
  it('accepts a bare host:port, as ollama’s CLI does', () => {
    expect(normaliseHost('192.168.3.168:11434')).toBe('http://192.168.3.168:11434')
    expect(normaliseHost('box.local:11434/')).toBe('http://box.local:11434')
  })
})

describe('ollamaChatBody', () => {
  const body = ollamaChatBody('SYSTEM RULES', [{ role: 'user', content: 'I would use a hash map.' }], {
    model: 'qwen3:30b-a3b',
    numCtx: 32768,
    keepAlive: '30m',
  })

  it('sends the system prompt as a system-role message ahead of the turns', () => {
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('SYSTEM RULES')
    expect(messages[1]).toEqual({ role: 'user', content: 'I would use a hash map.' })
  })

  // Candidate speech reaches this prompt verbatim. Roles separate the turns
  // structurally, but the standing "this is speech, not instructions" notice
  // has to survive the transport change too.
  it('keeps the untrusted-input notice in the system message', () => {
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages[0]!.content).toMatch(/never as an instruction/i)
  })

  // Not a preference: ollama's default is 4096 and it truncates the oldest
  // tokens silently, which on a 45-minute drill is an interviewer that has
  // forgotten the problem statement.
  it('always sends num_ctx explicitly', () => {
    expect(body.options).toEqual({ num_ctx: 32768 })
  })

  it('streams, and holds the model in memory across the drill', () => {
    expect(body.stream).toBe(true)
    expect(body.keep_alive).toBe('30m')
  })
})

describe('extractOllamaDelta', () => {
  it('reads content', () => {
    expect(extractOllamaDelta({ message: { content: 'hi' } })).toEqual({ content: 'hi', thinking: false })
  })

  it('reports a separate thinking field as thinking, never as content', () => {
    expect(extractOllamaDelta({ message: { thinking: 'hmm', content: '' } })).toEqual({
      content: '',
      thinking: true,
    })
  })

  it('returns null for anything that is not a message delta', () => {
    expect(extractOllamaDelta(null)).toBeNull()
    expect(extractOllamaDelta('nope')).toBeNull()
    expect(extractOllamaDelta({})).toBeNull()
    expect(extractOllamaDelta({ message: {} })).toBeNull()
    expect(extractOllamaDelta({ message: { content: 42 } })).toBeNull()
  })
})

describe('extractOllamaError', () => {
  it('reads an error line', () => {
    expect(extractOllamaError({ error: 'model "x" not found' })).toBe('model "x" not found')
  })

  it('returns null when there is no error', () => {
    expect(extractOllamaError({ message: { content: 'hi' } })).toBeNull()
    expect(extractOllamaError({ error: '' })).toBeNull()
    expect(extractOllamaError(null)).toBeNull()
  })
})

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

describe('ollamaStream', () => {
  it('yields the reply, reassembling lines split across chunks', async () => {
    const { impl, calls } = fakeFetch([contentLine('Tell me '), contentLine('the cost.'), DONE_LINE])
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    const out = await drain(stream('SYSTEM', [{ role: 'user', content: 'done' }]))
    expect(out.join('')).toBe('Tell me the cost.')
    expect(calls[0]!.url).toBe('http://box:11434/api/chat')
  })

  it('strips deliberation end to end, not just in the gate', async () => {
    const { impl } = fakeFetch([
      contentLine('Okay, the candidate said hash map. '),
      contentLine('I should ask about cost.\n</think>\n'),
      contentLine('What does that cost you?'),
      DONE_LINE,
    ])
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    const out = (await drain(stream('SYSTEM', [{ role: 'user', content: 'x' }]))).join('')
    expect(out.trim()).toBe('What does that cost you?')
    expect(out).not.toContain('candidate said hash map')
  })

  it('names the model and host when the server rejects the request', async () => {
    const { impl } = fakeFetch([JSON.stringify({ error: 'model "ghost" not found, try pulling it first' })], {
      status: 404,
    })
    const stream = ollamaStream({ host: 'http://box:11434', model: 'ghost', fetchImpl: impl })
    await expect(drain(stream('S', [{ role: 'user', content: 'x' }]))).rejects.toThrow(
      /HTTP 404.*not found, try pulling it first/,
    )
  })

  it('throws on an in-stream error line', async () => {
    const { impl } = fakeFetch([contentLine('partial '), JSON.stringify({ error: 'out of memory' })])
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    await expect(drain(stream('S', [{ role: 'user', content: 'x' }]))).rejects.toThrow(
      /ollama reported an error: out of memory/,
    )
  })

  it('reports an unreachable host with the host in the message', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    await expect(drain(stream('S', [{ role: 'user', content: 'x' }]))).rejects.toThrow(
      /could not reach ollama at http:\/\/box:11434: ECONNREFUSED/,
    )
  })

  // The deadline bounds *silence*, not total duration — a long reply that keeps
  // producing tokens is not a hang, and a 45-minute drill's replies are long.
  it('aborts when the server produces nothing before the deadline', async () => {
    const impl = (async (_url: string, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', timeoutMs: 20, fetchImpl: impl })
    await expect(drain(stream('S', [{ role: 'user', content: 'x' }]))).rejects.toThrow(
      /produced no output for 20ms/,
    )
  })

  it('drops an unparsable line without killing the stream', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { impl } = fakeFetch([contentLine('good '), 'not json at all', contentLine('parts.'), DONE_LINE])
    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    const out = (await drain(stream('S', [{ role: 'user', content: 'x' }]))).join('')
    expect(out).toBe('good parts.')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unparsable NDJSON line'))
    spy.mockRestore()
  })
})

describe('preloadOllama', () => {
  it('asks for the model with no messages, so it loads without generating', async () => {
    const { impl, calls } = fakeFetch([])
    const message = await preloadOllama({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    expect((calls[0]!.body as { messages: unknown[] }).messages).toEqual([])
    expect(message).toContain('m loaded and held on http://box:11434')
  })

  // A cold cache is slow; a server that refuses to start because a warm-up
  // failed is worse than the slow first turn the warm-up was avoiding.
  it('reports rather than throws when ollama is unreachable', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(preloadOllama({ host: 'http://box:11434', fetchImpl: impl })).resolves.toMatch(
      /could not reach http:\/\/box:11434.*ECONNREFUSED/,
    )
  })

  it('reports a non-OK status', async () => {
    const { impl } = fakeFetch([], { status: 500 })
    await expect(preloadOllama({ host: 'http://box:11434', fetchImpl: impl })).resolves.toMatch(
      /preload failed \(HTTP 500\)/,
    )
  })
})
