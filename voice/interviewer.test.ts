import { describe, expect, it } from 'vitest'
import { createInterviewer, type Message, type StreamFn } from './interviewer'

/** A stream that replays scripted deltas and records what it was sent. */
function scripted(turns: string[][]) {
  const seen: { system: string; messages: Message[] }[] = []
  let index = 0
  const stream: StreamFn = async function* (system, messages) {
    seen.push({ system, messages: structuredClone(messages) })
    for (const delta of turns[index] ?? []) yield delta
    index++
  }
  return { stream, seen }
}

async function collect(sentences: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const sentence of sentences) out.push(sentence)
  return out
}

describe('createInterviewer', () => {
  it('yields sentences as they complete', async () => {
    const { stream } = scripted([['What are we ', 'optimising for? ', 'Be specific.']])
    const interviewer = createInterviewer('SYSTEM', stream)
    expect(await collect(interviewer.turn('Ready.'))).toEqual([
      'What are we optimising for?',
      'Be specific.',
    ])
  })

  it('passes the system prompt through unchanged', async () => {
    const { stream, seen } = scripted([['Go.']])
    await collect(createInterviewer('SYSTEM', stream).turn('Ready.'))
    expect(seen[0]!.system).toBe('SYSTEM')
  })

  it('accumulates history across turns', async () => {
    const { stream, seen } = scripted([['First question.'], ['Second question.']])
    const interviewer = createInterviewer('SYSTEM', stream)
    await collect(interviewer.turn('Ready.'))
    await collect(interviewer.turn('Read latency.'))
    expect(seen[1]!.messages).toEqual([
      { role: 'user', content: 'Ready.' },
      { role: 'assistant', content: 'First question.' },
      { role: 'user', content: 'Read latency.' },
    ])
  })

  it('never speaks the story-log trailer', async () => {
    const { stream } = scripted([
      ['Cut the middle minute. ', '```story-log\ncompetency: Conflict\n```'],
    ])
    const interviewer = createInterviewer('SYSTEM', stream)
    expect(await collect(interviewer.turn('Done.'))).toEqual(['Cut the middle minute.'])
  })

  it('keeps the trailer available on the raw turn', async () => {
    const { stream } = scripted([['Cut it. ', '```story-log\ncompetency: Conflict\n```']])
    const interviewer = createInterviewer('SYSTEM', stream)
    await collect(interviewer.turn('Done.'))
    expect(interviewer.lastRaw()).toContain('competency: Conflict')
  })
})
