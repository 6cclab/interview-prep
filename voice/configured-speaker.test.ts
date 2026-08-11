import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configuredSpeaker } from './http-server'
import type { SayOptions, Speaker } from './speech'

/**
 * The production `Speaker` the browser path uses.
 *
 * The first test here is a regression test for a bug that shipped: this factory
 * used to return a bare `{ speak }` closure, so `Speaker.stop` did not exist on
 * it at all. `deps.speaker?.stop?.()` in the SSE close handler then optional-chained
 * into nothing, and refreshing the page left `say` reading the interviewer's reply
 * to an empty room — the exact symptom `stop` was introduced to fix. Only the
 * terminal front end, which passes `saySpeaker` straight through, ever had it.
 *
 * A fake factory rather than the real `saySpeaker` because the assertion is about
 * *reaching* the utterance in flight, not about macOS `say` — spawning a
 * subprocess to prove a delegation would be testing third-party software.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'configured-speaker-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeConfig(body: string) {
  mkdirSync(join(root, 'local'), { recursive: true })
  writeFileSync(join(root, 'local/voice.json'), body)
}

interface FakeSpeaker extends Speaker {
  opts: SayOptions
  stopped: boolean
}

/** Records how it was configured, and never resolves until released. */
function fakeFactory() {
  const made: FakeSpeaker[] = []
  const release: Array<() => void> = []
  const factory = (opts: SayOptions): Speaker => {
    const fake: FakeSpeaker = {
      opts,
      stopped: false,
      speak: () =>
        new Promise<void>((resolve) => {
          release.push(resolve)
        }),
      stop: () => {
        fake.stopped = true
        // A real `say` kill resolves the pending speak as a cancellation rather
        // than a failure; the fake has to do the same or the awaiting caller hangs.
        release.forEach((r) => r())
      },
    }
    made.push(fake)
    return fake
  }
  return { factory, made, releaseAll: () => release.forEach((r) => r()) }
}

describe('configuredSpeaker', () => {
  it('implements stop — the bug was that it did not', () => {
    expect(typeof configuredSpeaker(root, fakeFactory().factory).stop).toBe('function')
  })

  it('stop reaches the utterance in flight', async () => {
    const { factory, made } = fakeFactory()
    const speaker = configuredSpeaker(root, factory)

    const speaking = speaker.speak('a sentence nobody is listening to')
    // Not awaited yet: the point is to stop it mid-utterance, which is what a
    // page refresh does.
    speaker.stop?.()
    await speaking

    expect(made).toHaveLength(1)
    expect(made[0]?.stopped).toBe(true)
  })

  it('stop after the utterance finished is a no-op rather than a throw', async () => {
    const { factory, releaseAll } = fakeFactory()
    const speaker = configuredSpeaker(root, factory)
    const speaking = speaker.speak('one')
    releaseAll()
    await speaking
    expect(() => speaker.stop?.()).not.toThrow()
  })

  it('passes the configured voice, rate and output device through', async () => {
    writeConfig('{ "voice": "Ava (Premium)", "rate": 170, "output": "75" }')
    const { factory, made, releaseAll } = fakeFactory()
    const speaker = configuredSpeaker(root, factory)
    const speaking = speaker.speak('hello')
    releaseAll()
    await speaking
    expect(made[0]?.opts).toEqual({ voice: 'Ava (Premium)', rate: 170, audioDevice: '75' })
  })

  it('re-reads the config between sentences, so an edit lands on the next one', async () => {
    writeConfig('{ "voice": "Samantha" }')
    const { factory, made, releaseAll } = fakeFactory()
    const speaker = configuredSpeaker(root, factory)

    let speaking = speaker.speak('first')
    releaseAll()
    await speaking

    writeConfig('{ "voice": "Daniel" }')
    speaking = speaker.speak('second')
    releaseAll()
    await speaking

    expect(made.map((m) => m.opts.voice)).toEqual(['Samantha', 'Daniel'])
  })

  it('passes nothing at all when the config is empty, leaving the system default', async () => {
    const { factory, made, releaseAll } = fakeFactory()
    const speaker = configuredSpeaker(root, factory)
    const speaking = speaker.speak('hello')
    releaseAll()
    await speaking
    // Not `{ voice: undefined }` — `sayArgs` omits a flag it is not given, and an
    // explicit undefined would be the same thing here only by luck.
    expect(made[0]?.opts).toEqual({ audioDevice: undefined })
  })
})
