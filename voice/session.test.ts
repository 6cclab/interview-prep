import { describe, expect, it, vi } from 'vitest'
import { runSession, type SessionDeps } from './session'
import type { Interviewer } from './interviewer'

function fakeInterviewer(replies: string[]): Interviewer {
  let index = 0
  return {
    async *turn() {
      for (const sentence of (replies[index] ?? '').split('|')) yield sentence
      index++
    },
    lastRaw: () => replies[index - 1] ?? '',
  }
}

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  const turns: ('speak' | 'end')[] = ['speak', 'end']
  let tick = 0
  return {
    transcriber: { transcribe: async () => ({ text: 'Read latency.' }) },
    speaker: { speak: async () => {} },
    interviewer: fakeInterviewer(['What are we optimising for?', 'Good. Stop there.']),
    startRecording: () => ({ stop: async () => '/tmp/turn.wav' }),
    nextTurn: async () => turns.shift() ?? 'end',
    now: () => (tick += 1000),
    ...overrides,
  }
}

describe('runSession', () => {
  it('opens with the interviewer, not with Andre', async () => {
    const entries = await runSession(deps())
    expect(entries[0]!.speaker).toBe('interviewer')
  })

  it('records what Andre said, verbatim from the transcriber', async () => {
    const entries = await runSession(deps())
    expect(entries.map((e) => e.text)).toContain('Read latency.')
  })

  it('speaks every sentence the interviewer produces', async () => {
    const speak = vi.fn(async () => {})
    await runSession(deps({ speaker: { speak } }))
    expect(speak).toHaveBeenCalledWith('What are we optimising for?')
  })

  it('stops recording before transcribing', async () => {
    const order: string[] = []
    await runSession(
      deps({
        startRecording: () => ({
          stop: async () => {
            order.push('stop')
            return '/tmp/turn.wav'
          },
        }),
        transcriber: {
          transcribe: async () => {
            order.push('transcribe')
            return { text: 'Read latency.' }
          },
        },
      }),
    )
    // A final recorder is opened and stopped on the closing turn too, so this
    // asserts on the first cycle rather than the whole sequence.
    expect(order.slice(0, 2)).toEqual(['stop', 'transcribe'])
  })

  it('ends without a final user turn when Andre ends the session', async () => {
    const entries = await runSession(deps({ nextTurn: async () => 'end' }))
    expect(entries.every((e) => e.speaker === 'interviewer')).toBe(true)
  })

  it('stamps each entry with elapsed time', async () => {
    const entries = await runSession(deps())
    expect(entries.every((e) => typeof e.at === 'number')).toBe(true)
  })
})
