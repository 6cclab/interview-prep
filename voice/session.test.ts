import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSession, type SessionDeps, type SessionOutcome } from './session'
import { createInterviewer, type Interviewer } from './interviewer'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, finishSession } from './session'

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

  it('stamps Andre at the moment recording stopped, not after transcription latency', async () => {
    // A clock that only moves when told to. It stays at 0 through recording
    // and only jumps forward inside `transcribe`, standing in for the real
    // seconds whisper.cpp spends on a long answer. A stub that "transcribes"
    // instantly can't distinguish "stamped before transcription" from
    // "stamped after" — this one can, because the two produce different
    // numbers.
    let clock = 0
    const entries = await runSession(
      deps({
        now: () => clock,
        transcriber: {
          transcribe: async () => {
            clock += 5000 // simulated whisper.cpp latency
            return { text: 'Read latency.' }
          },
        },
      }),
    )
    const andre = entries.find((e) => e.speaker === 'andre')!
    // Stamped when the user actually stopped speaking (before transcription
    // ran the clock forward), not once transcription finished.
    expect(andre.at).toBe(0)
    expect(andre.at).toBeLessThan(5000)
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

    it('stamps the early-end marker when transcription fails at the moment recording stopped, not after transcription latency', async () => {
      // Same technique as the successful-turn case: a clock that only moves
      // when told to, and jumps forward inside the failing operation. If the
      // marker re-samples the clock after `transcribe` returns (rather than
      // reusing the pre-transcribe timestamp), this catches it — a bare
      // `typeof at === 'number'` assertion would not.
      let clock = 0
      const entries = (await runSession(
        deps({
          now: () => clock,
          transcriber: {
            transcribe: async () => {
              clock += 5000 // simulated whisper.cpp latency before the failure surfaces
              throw new Error('whisper-cli: model not found')
            },
          },
        }),
      )) as SessionOutcome

      const marker = entries.find((e) => /ended early/i.test(e.text))!
      expect(marker.at).toBe(0)
      expect(marker.at).toBeLessThan(5000)
    })
  })
})

describe('createSession', () => {
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

  it('begin() yields the opening reply and records no Andre entry', async () => {
    const session = createSession({ interviewer: fakeInterviewer(['Ready when you are.']), now: () => 0 })
    const sentences: string[] = []
    for await (const s of session.begin()) sentences.push(s)
    expect(sentences).toEqual(['Ready when you are.'])
    expect(session.entries()).toEqual([{ speaker: 'interviewer', text: 'Ready when you are.', at: 0 }])
  })

  // End to end over the *real* interviewer, because this is the one property the
  // pairing code feature rests on and the unit tests each only see half of it:
  // the snippet has to reach the entry (so the pane and the saved transcript
  // show it) while never reaching the sentences (so it is not read aloud).
  describe('a coach reply carrying code', () => {
    function codeSession() {
      const deltas = [
        'Start from the counts. ',
        '```ts\nfor (const k in a) {\n  if (a[k] !== b[k]) return false\n}\n```',
        '\n\nNow why return early?',
      ]
      const interviewer = createInterviewer('SYSTEM', async function* () {
        for (const delta of deltas) yield delta
      })
      return createSession({ interviewer, now: () => 0 })
    }

    it('keeps the snippet out of everything that gets spoken', async () => {
      const spoken: string[] = []
      for await (const s of codeSession().begin()) spoken.push(s)
      expect(spoken).toEqual(['Start from the counts.', 'Now why return early?'])
      expect(spoken.join(' ')).not.toContain('`')
      expect(spoken.join(' ')).not.toContain('return false')
    })

    it('puts the snippet in the entry, fence intact, with the prose around it', async () => {
      const session = codeSession()
      for await (const _ of session.begin()) void _
      const { text } = session.entries()[0]!
      expect(text).toContain('```ts')
      expect(text).toContain('if (a[k] !== b[k]) return false')
      expect(text).toContain('Start from the counts.')
      expect(text).toContain('Now why return early?')
    })

    it('still keeps a log trailer out of the entry when one follows the code', async () => {
      const interviewer = createInterviewer('SYSTEM', async function* () {
        yield 'Good session. '
        yield '```ts\nconst a = 1\n```'
        yield '\n\n```drill-log\nsolved: yes\nnote: n\n```'
      })
      const session = createSession({ interviewer, now: () => 0 })
      for await (const _ of session.begin()) void _
      const { text } = session.entries()[0]!
      expect(text).toContain('const a = 1')
      expect(text).not.toContain('solved')
      expect(text).not.toContain('drill-log')
    })
  })

  it('submitTurn() records the Andre entry immediately, before the reply arrives', async () => {
    let ticks = 0
    const session = createSession({ interviewer: fakeInterviewer(['Go on.']), now: () => (ticks += 100) })
    const iter = session.submitTurn('Ready latency.', 100)
    const first = await iter[Symbol.asyncIterator]().next()
    expect(first.value).toBe('Go on.')
    expect(session.entries()[0]).toEqual({ speaker: 'andre', text: 'Ready latency.', at: 100 })
  })

  it('endedEarly() is unset after a normal turn', async () => {
    const session = createSession({ interviewer: fakeInterviewer(['Fine.']), now: () => 0 })
    for await (const _ of session.begin()) void _
    expect(session.endedEarly()).toBeUndefined()
  })

  it('a failing interviewer turn ends the session and leaves a synthetic entry', async () => {
    const failing: Interviewer = {
      async *turn() {
        throw new Error('stream exploded')
      },
      lastRaw: () => '',
    }
    const session = createSession({ interviewer: failing, now: () => 42 })
    const sentences: string[] = []
    for await (const s of session.begin()) sentences.push(s)
    expect(sentences).toEqual([])
    expect(session.endedEarly()).toBe('stream exploded')
    expect(session.entries()[0]!.text).toMatch(/ended early.*stream exploded/i)
  })

  it('stamps the early-end marker at turn-start, not after the failing stream runs', async () => {
    // Same technique as `runSession`'s transcription case: a clock that only
    // advances inside the failing operation. If the marker re-samples the
    // clock after the stream throws (rather than reusing the timestamp
    // captured at the top of the turn), this catches it.
    let clock = 0
    const flaky: Interviewer = {
      async *turn() {
        clock += 5000 // simulated slow stream before it throws
        throw new Error('stream failed')
      },
      lastRaw: () => '',
    }
    const session = createSession({ interviewer: flaky, now: () => clock })
    for await (const _ of session.begin()) void _
    expect(session.entries()[0]!.at).toBe(0)
    expect(session.entries()[0]!.at).toBeLessThan(5000)
  })

  it('reportFailure() marks the session ended without needing a turn', () => {
    const session = createSession({ interviewer: fakeInterviewer([]), now: () => 7 })
    session.reportFailure('transcode failed', 7)
    expect(session.endedEarly()).toBe('transcode failed')
    expect(session.entries()).toEqual([
      { speaker: 'interviewer', text: '[Session ended early — transcode failed]', at: 7 },
    ])
  })
})

describe('finishSession', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voice-finish-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes the transcript to local/mock-<date>-<hhmm>.md', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    session.submitTurn('Ready latency.', 0)
    const startedAt = new Date('2026-08-07T10:00:00.000Z')
    const { relPath } = finishSession(session, { turn: async function* () {}, lastRaw: () => '' }, {
      root,
      userId: null,
      track: 'mock',
      startedAt,
    })
    expect(relPath).toBe('local/mock-2026-08-07-1000.md')
    expect(readFileSync(join(root, relPath), 'utf8')).toContain('Ready latency.')
  })

  it('appends the story log when the interviewer emitted a trailer', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    const raw = '```story-log\ncompetency: Conflict\nstory: The migration\nworked: Owned the timeline\nfix: Name the tradeoff sooner\n```'
    const { storyLogWritten } = finishSession(session, { turn: async function* () {}, lastRaw: () => raw }, {
      root,
      userId: null,
      track: 'mock',
      startedAt: new Date('2026-08-07T10:00:00.000Z'),
    })
    expect(storyLogWritten).toBe(true)
    expect(readFileSync(join(root, 'local/stories.md'), 'utf8')).toContain('## Conflict')
  })

  it('does not write a story log when the interviewer emitted no trailer', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    const { storyLogWritten } = finishSession(session, { turn: async function* () {}, lastRaw: () => 'No trailer here.' }, {
      root,
      userId: null,
      track: 'mock',
      startedAt: new Date('2026-08-07T10:00:00.000Z'),
    })
    expect(storyLogWritten).toBe(false)
  })
})
