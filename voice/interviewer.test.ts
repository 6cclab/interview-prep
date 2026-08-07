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

  it('catches a fence split across two deltas', async () => {
    const { stream } = scripted([
      ['Cut the middle minute. ', '``', '`story-log\ncompetency: Conflict\n```'],
    ])
    const interviewer = createInterviewer('SYSTEM', stream)
    const sentences = await collect(interviewer.turn('Done.'))
    expect(sentences).toEqual(['Cut the middle minute.'])
    for (const sentence of sentences) {
      expect(sentence).not.toContain('`')
      expect(sentence).not.toContain('competency')
    }
  })

  it('catches a fence split with a different straddle', async () => {
    const { stream } = scripted([['Fine. ', '`', '``story-log\ncompetency: Conflict\n```']])
    const interviewer = createInterviewer('SYSTEM', stream)
    const sentences = await collect(interviewer.turn('Done.'))
    expect(sentences).toEqual(['Fine.'])
    for (const sentence of sentences) {
      expect(sentence).not.toContain('`')
      expect(sentence).not.toContain('competency')
    }
  })

  it('does not lose the tail when no fence appears', async () => {
    const { stream } = scripted([['One two three']])
    const interviewer = createInterviewer('SYSTEM', stream)
    expect(await collect(interviewer.turn('Done.'))).toEqual(['One two three'])
  })

  it('rolls back the user message when the stream throws mid-turn', async () => {
    const seen: { system: string; messages: Message[] }[] = []
    let call = 0
    const stream: StreamFn = async function* (system, messages) {
      seen.push({ system, messages: structuredClone(messages) })
      if (call === 0) {
        call++
        yield 'Partial reply. '
        throw new Error('stream exploded')
      }
      yield 'Second reply.'
    }
    const interviewer = createInterviewer('SYSTEM', stream)

    await expect(collect(interviewer.turn('First.'))).rejects.toThrow('stream exploded')

    await collect(interviewer.turn('First.'))
    expect(seen[1]!.messages).toEqual([{ role: 'user', content: 'First.' }])
  })

  it('rejects and leaves history unchanged on an empty stream', async () => {
    const { stream, seen } = scripted([[], ['Second reply.']])
    const interviewer = createInterviewer('SYSTEM', stream)
    await expect(collect(interviewer.turn('First.'))).rejects.toThrow()

    await collect(interviewer.turn('First.'))
    expect(seen[1]!.messages).toEqual([{ role: 'user', content: 'First.' }])
  })
})
