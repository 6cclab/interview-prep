import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSession, type SessionDeps, type SessionOutcome } from './session'
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
    const speak = vi.fn(async (_sentence: string) => {})
    await runSession(
      deps({
        speaker: { speak },
        interviewer: fakeInterviewer(['One.|Two.|Three.']),
        // End right after the first (multi-sentence) turn, so the spy only
        // ever sees the sentences from the turn under test.
        nextTurn: async () => 'end',
      }),
    )
    expect(speak.mock.calls.map((call) => call[0])).toEqual(['One.', 'Two.', 'Three.'])
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
    // A dedicated, deterministic clock: proves the stamps actually advance
    // across entries rather than tolerating an implementation that hardcodes
    // `at: 0`. No wall-clock/sleeping involved, so this can't flake.
    let clock = 0
    const entries = await runSession(deps({ now: () => (clock += 500) }))
    expect(entries.map((e) => e.at)).toEqual([500, 1000, 1500])
  })

  describe('when a turn fails mid-session', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it('keeps the entries already collected and signals the early end', async () => {
      let calls = 0
      const flaky: Interviewer = {
        async *turn() {
          calls++
          if (calls === 1) {
            yield 'First reply.'
            return
          }
          throw new Error('stream failed')
        },
        lastRaw: () => '',
      }

      const entries = (await runSession(deps({ interviewer: flaky }))) as SessionOutcome

      // The completed turns survive by the normal return path...
      expect(entries.map((e) => e.speaker)).toEqual(['interviewer', 'andre', 'interviewer'])
      expect(entries[0]!.text).toBe('First reply.')
      expect(entries[1]!.text).toBe('Read latency.')

      // ...and the early end is visible, not a silent or normal-looking stop.
      expect(entries[2]!.text).toMatch(/ended early/i)
      expect(entries.endedEarly).toBeTruthy()
      expect(errorSpy).toHaveBeenCalled()
    })

    it('keeps prior entries and signals early end when the recorder fails to stop', async () => {
      const stop = vi.fn(async () => {
        throw new Error('ffmpeg exited with code 1')
      })
      const entries = (await runSession(
        deps({ startRecording: () => ({ stop }) }),
      )) as SessionOutcome

      // The opening turn survives, and nothing further is added.
      expect(entries.map((e) => e.speaker)).toEqual(['interviewer', 'interviewer'])
      expect(entries[1]!.text).toMatch(/ended early/i)
      expect(entries[1]!.text).toMatch(/recording failed/i)
      expect(entries.endedEarly).toMatch(/recording failed/i)
      expect(errorSpy).toHaveBeenCalled()

      // The recorder that was successfully started was still asked to stop —
      // no leaked ffmpeg process outliving the drill.
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it('keeps prior entries and signals early end when transcription fails, and still stops the recorder', async () => {
      const stop = vi.fn(async () => '/tmp/turn.wav')
      const entries = (await runSession(
        deps({
          startRecording: () => ({ stop }),
          transcriber: {
            transcribe: async () => {
              throw new Error('whisper-cli: model not found')
            },
          },
        }),
      )) as SessionOutcome

      expect(entries.map((e) => e.speaker)).toEqual(['interviewer', 'interviewer'])
      expect(entries[1]!.text).toMatch(/ended early/i)
      expect(entries[1]!.text).toMatch(/transcription failed/i)
      expect(entries.endedEarly).toMatch(/transcription failed/i)
      expect(errorSpy).toHaveBeenCalled()

      // Transcription only runs after the recorder has already been stopped
      // successfully, so this confirms it wasn't left running either.
      expect(stop).toHaveBeenCalledTimes(1)
    })
  })
})
