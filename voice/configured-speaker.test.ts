import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configuredSpeaker } from './http-server'
import type { SayOptions, Speaker } from './speech'

/**
 * `configuredSpeaker` is the production `Speaker` handed to `deps.speaker`.
 * Two behaviours have regressed before and have no other test guarding them:
 * re-reading `local/voice.json` on every sentence (so a device change mid-drill
 * takes effect on the next sentence, no restart), and a working `stop()` (once
 * a bare closure with no way to reach the in-flight utterance, so a page
 * refresh mid-turn left the interviewer talking to an empty room). The
 * injected factory parameter is what makes both assertable without spawning a
 * real speech engine.
 */
describe('configuredSpeaker', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'configured-speaker-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads local/voice.json fresh on every sentence rather than once at construction', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/voice.json'), JSON.stringify({ output: 'first' }))

    const seenDevices: (string | undefined)[] = []
    const factory = (opts: SayOptions): Speaker => {
      seenDevices.push(opts.audioDevice)
      return { async speak() {} }
    }

    const speaker = configuredSpeaker(root, factory)
    await speaker.speak('one')

    writeFileSync(join(root, 'local/voice.json'), JSON.stringify({ output: 'second' }))
    await speaker.speak('two')

    expect(seenDevices).toEqual(['first', 'second'])
  })

  it('stop() reaches the utterance currently in flight', async () => {
    let stopped = false
    const factory = (): Speaker => ({
      async speak() {
        // never resolves on its own — only `stop()` ends it in this test
        await new Promise(() => {})
      },
      stop() {
        stopped = true
      },
    })

    const speaker = configuredSpeaker(root, factory)
    void speaker.speak('hello')
    // let the async speak() start before stopping it
    await new Promise((resolve) => setImmediate(resolve))
    speaker.stop?.()

    expect(stopped).toBe(true)
  })

  it('stop() before any utterance has started is a no-op, not a crash', () => {
    const speaker = configuredSpeaker(root, () => ({ async speak() {} }))
    expect(() => speaker.stop?.()).not.toThrow()
  })
})
