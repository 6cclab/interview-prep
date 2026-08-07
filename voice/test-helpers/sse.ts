interface ReaderState {
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: InstanceType<typeof TextDecoder>
  buffer: string
}

// Two events written back-to-back by the server (e.g. the opening turn's
// single `sentence` immediately followed by its `entry`) can arrive in one
// `read()` chunk. Re-acquiring a fresh reader and an empty buffer on every
// call — as a naive one-shot version of this helper would — throws away
// whatever followed the first `\n\n` in that chunk, and the next call then
// blocks forever waiting for bytes that already went by. Keeping the reader
// and any unconsumed tail keyed on the response lets repeated calls drain
// one event at a time regardless of how the server happened to batch them.
const readers = new WeakMap<Response, ReaderState>()

export async function readSSE(response: Response): Promise<{ event: string; data: unknown }> {
  if (!response.body) throw new Error('response has no body')
  let state = readers.get(response)
  if (!state) {
    state = { reader: response.body.getReader(), decoder: new TextDecoder(), buffer: '' }
    readers.set(response, state)
  }

  while (!state.buffer.includes('\n\n')) {
    const { value, done } = await state.reader.read()
    if (done) throw new Error('SSE stream ended before a full event arrived')
    state.buffer += state.decoder.decode(value, { stream: true })
  }

  const boundary = state.buffer.indexOf('\n\n')
  const raw = state.buffer.slice(0, boundary)
  state.buffer = state.buffer.slice(boundary + 2)

  const lines = raw.split('\n')
  const eventLine = lines.find((l) => l.startsWith('event:'))
  const dataLine = lines.find((l) => l.startsWith('data:'))
  if (!eventLine || !dataLine) throw new Error(`malformed SSE block: ${raw}`)

  return { event: eventLine.slice('event:'.length).trim(), data: JSON.parse(dataLine.slice('data:'.length).trim()) }
}
