import { describe, expect, it, vi } from 'vitest'
import {
  extractOllamaDelta,
  extractOllamaError,
  normaliseHost,
  ollamaChatBody,
  ollamaHeaders,
  isThinkingUnsupported,
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
    expect(normaliseHost('http://10.0.0.5:11434')).toBe('http://10.0.0.5:11434')
    expect(normaliseHost('http://10.0.0.5:11434/')).toBe('http://10.0.0.5:11434')
    expect(normaliseHost('https://ollama.example.com')).toBe('https://ollama.example.com')
  })

  // `OLLAMA_HOST=10.0.0.5:11434` is valid for ollama's own CLI, so a
  // working shell config must not break when this code reads the same variable.
  it('accepts a bare host:port, as ollama’s CLI does', () => {
    expect(normaliseHost('10.0.0.5:11434')).toBe('http://10.0.0.5:11434')
    expect(normaliseHost('box.local:11434/')).toBe('http://box.local:11434')
  })
})

describe('ollamaChatBody', () => {
  const body = ollamaChatBody('SYSTEM RULES', [{ role: 'user', content: 'I would use a hash map.' }], {
    model: 'qwen3:30b-a3b',
    numCtx: 32768,
    keepAlive: '30m',
    think: true,
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

describe('ollamaHeaders', () => {
  // Absent must keep meaning unauthenticated: pointing OLLAMA_HOST straight at a
  // box is the arrangement that works today, and the gateway is an addition
  // rather than a migration. A drill should not start depending on a service
  // that can be down.
  it('sends only content-type when there is no key', () => {
    expect(ollamaHeaders(undefined)).toEqual({ 'content-type': 'application/json' })
  })

  it('adds a bearer token when there is one', () => {
    expect(ollamaHeaders('k')).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer k',
    })
  })

  // Same stance as `chooseBackend`'s variables: an empty or whitespace-only
  // value reads as unset, so `OLLAMA_API_KEY= ` clears an inherited export
  // instead of sending `Bearer `.
  it('treats a blank key as unset', () => {
    expect(ollamaHeaders('   ')).toEqual({ 'content-type': 'application/json' })
  })
})

describe('gateway authentication', () => {
  it('preloadOllama sends the bearer token when a key is configured', async () => {
    let seen: Record<string, string> = {}
    await preloadOllama({
      apiKey: 'secret-token',
      fetchImpl: async (_url, init) => {
        seen = init?.headers as Record<string, string>
        return new Response('{}', { status: 200 })
      },
    })
    expect(seen.authorization).toBe('Bearer secret-token')
  })

  it('preloadOllama sends no authorization header without a key', async () => {
    let seen: Record<string, string> = {}
    await preloadOllama({
      fetchImpl: async (_url, init) => {
        seen = init?.headers as Record<string, string>
        return new Response('{}', { status: 200 })
      },
    })
    expect(seen.authorization).toBeUndefined()
  })

  it('ollamaStream sends the bearer token when a key is configured', async () => {
    let seen: Record<string, string> = {}
    const stream = ollamaStream({
      apiKey: 'secret-token',
      fetchImpl: async (_url, init) => {
        seen = init?.headers as Record<string, string>
        return new Response('{"message":{"content":"hi"},"done":true}\n', { status: 200 })
      },
    })
    await drain(stream('SYSTEM', []))
    expect(seen.authorization).toBe('Bearer secret-token')
  })

  it('ollamaStream sends no authorization header without a key', async () => {
    let seen: Record<string, string> = {}
    const stream = ollamaStream({
      fetchImpl: async (_url, init) => {
        seen = init?.headers as Record<string, string>
        return new Response('{"message":{"content":"hi"},"done":true}\n', { status: 200 })
      },
    })
    await drain(stream('SYSTEM', []))
    expect(seen.authorization).toBeUndefined()
  })

  // A token in a saved transcript would be a bad way to discover this. Error
  // text from this module reaches the client and the drill transcript.
  it('never puts the key in an error message', async () => {
    const stream = ollamaStream({
      apiKey: 'secret-token',
      fetchImpl: async () => new Response('{"error":"model not found"}', { status: 404 }),
    })
    await expect(drain(stream('SYSTEM', []))).rejects.toThrow(
      expect.not.stringContaining('secret-token') as unknown as string,
    )
  })
})

/**
 * Asking for a thinking channel, and coping when there isn't one.
 *
 * `think` was hard `false` until this. The reasoning was that ollama 0.24.0
 * ignored the flag, so the gate had to do the work regardless — true, and the
 * wrong conclusion: a reasoning model told not to use a thinking channel does
 * not stop reasoning. It reasons in prose, into `content`, untagged, where the
 * gate cannot see it. Measured on `qwen3.8:latest` via ollama 0.32.15, the same
 * question answered in 1350 rambling characters with the flag off and 432 clean
 * ones with it on, the deliberation going to `thinking` where it belongs.
 */
describe('the thinking channel', () => {
  it('asks for one', () => {
    const body = ollamaChatBody('S', [{ role: 'user', content: 'hi' }], {
      model: 'm',
      numCtx: 8192,
      keepAlive: '30m',
      think: true,
    })
    expect(body.think).toBe(true)
  })

  // ollama 0.32.15 answers `think: true` for a non-reasoning model with HTTP
  // 400 and this exact sentence. It is a fact about the model, not the request.
  it('recognises a model that has no thinking channel', () => {
    expect(isThinkingUnsupported('"llama3.1:8b" does not support thinking')).toBe(true)
    expect(isThinkingUnsupported('model "ghost" not found')).toBe(false)
  })

  it('retries without the flag rather than failing the turn', async () => {
    const calls: Array<{ think: unknown }> = []
    const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? 'null')) as { think: unknown }
      calls.push({ think: body.think })
      if (body.think === true) {
        return new Response(JSON.stringify({ error: '"m" does not support thinking' }), {
          status: 400,
        })
      }
      return new Response(`${contentLine('the answer')}\n`, { status: 200 })
    }) as unknown as typeof fetch

    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    expect((await drain(stream('S', [{ role: 'user', content: 'hi' }]))).join('')).toContain(
      'the answer',
    )
    expect(calls.map((c) => c.think)).toEqual([true, false])
  })

  /**
   * And remembers. Rediscovering this on every turn costs a wasted round trip
   * per turn for the whole drill — the model cannot change under a stream
   * function, so one refusal settles it.
   */
  it('does not re-ask a model that has already refused', async () => {
    const calls: unknown[] = []
    const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? 'null')) as { think: unknown }
      calls.push(body.think)
      if (body.think === true) {
        return new Response(JSON.stringify({ error: '"m" does not support thinking' }), {
          status: 400,
        })
      }
      return new Response(`${contentLine('ok')}\n`, { status: 200 })
    }) as unknown as typeof fetch

    const stream = ollamaStream({ host: 'http://box:11434', model: 'm', fetchImpl: impl })
    await drain(stream('S', [{ role: 'user', content: 'one' }]))
    await drain(stream('S', [{ role: 'user', content: 'two' }]))
    expect(calls).toEqual([true, false, false])
  })

  // Any other 400 is a real failure and must still surface — a retry loop that
  // swallows "model not found" would turn a typo into a silent empty reply.
  it('does not retry an unrelated failure', async () => {
    const calls: unknown[] = []
    const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? 'null')).think)
      return new Response(JSON.stringify({ error: 'model "ghost" not found' }), { status: 404 })
    }) as unknown as typeof fetch

    const stream = ollamaStream({ host: 'http://box:11434', model: 'ghost', fetchImpl: impl })
    await expect(drain(stream('S', [{ role: 'user', content: 'hi' }]))).rejects.toThrow(
      /not found/,
    )
    expect(calls).toEqual([true])
  })
})
