import { describe, expect, it } from 'vitest'
import { createStreamedVoice, type AudioClip } from './streamedVoice'

interface FakeClip extends AudioClip {
  plays: number
  pauses: number
  fire(type: 'ended' | 'error'): void
}

function harness(playRejects = false) {
  const clips: FakeClip[] = []
  const clipFor = (url: string): FakeClip => {
    const listeners: Partial<Record<'ended' | 'error', () => void>> = {}
    const clip: FakeClip = {
      src: url,
      plays: 0,
      pauses: 0,
      play: async () => {
        clip.plays += 1
        if (playRejects) throw new Error('NotAllowedError')
      },
      pause: () => {
        clip.pauses += 1
      },
      addEventListener: (type, listener) => {
        listeners[type] = listener
      },
      fire: (type) => listeners[type]?.(),
    }
    clips.push(clip)
    return clip
  }
  return { clips, voice: createStreamedVoice(clipFor) }
}

describe('createStreamedVoice', () => {
  it('plays the first sentence immediately', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    expect(clips).toHaveLength(1)
    expect(clips[0]?.src).toBe('/say/0')
    expect(clips[0]?.plays).toBe(1)
  })

  // The whole reason this file exists. `SpeechSynthesis` queues for you;
  // `<audio>` does not, so two fast sentences would play over each other.
  it('does not start a second sentence while the first is still playing', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.speak('/say/1')
    voice.speak('/say/2')
    expect(clips).toHaveLength(1)
  })

  it('plays queued sentences in order as each one ends', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.speak('/say/1')
    voice.speak('/say/2')
    clips[0]?.fire('ended')
    expect(clips[1]?.src).toBe('/say/1')
    clips[1]?.fire('ended')
    expect(clips[2]?.src).toBe('/say/2')
    expect(clips.map((c) => c.src)).toEqual(['/say/0', '/say/1', '/say/2'])
  })

  it('starts playing again after the queue has drained', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    clips[0]?.fire('ended')
    expect(clips).toHaveLength(1)
    voice.speak('/say/1')
    expect(clips[1]?.plays).toBe(1)
  })

  // A 500 from the audio route costs the one sentence it was for. Wedging the
  // queue behind it would cost every sentence after it too, and the drill
  // would go silent for good.
  it('advances past a sentence whose audio failed to load', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.speak('/say/1')
    clips[0]?.fire('error')
    expect(clips[1]?.src).toBe('/say/1')
  })

  it('advances past a sentence the browser refused to autoplay', async () => {
    const { clips, voice } = harness(true)
    voice.speak('/say/0')
    voice.speak('/say/1')
    await Promise.resolve()
    await Promise.resolve()
    expect(clips[1]?.src).toBe('/say/1')
  })

  it('cancel stops what is playing and drops the rest', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.speak('/say/1')
    voice.cancel()
    expect(clips[0]?.pauses).toBe(1)
    expect(clips).toHaveLength(1)
  })

  // `pause()` can fire `ended` on some engines. If that advanced the queue, a
  // cancel would start playing the sentence it was cancelling.
  it('a cancelled clip firing ended does not resume the queue', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.speak('/say/1')
    voice.cancel()
    clips[0]?.fire('ended')
    expect(clips).toHaveLength(1)
  })

  it('speaks again normally after a cancel', () => {
    const { clips, voice } = harness()
    voice.speak('/say/0')
    voice.cancel()
    voice.speak('/say/1')
    expect(clips[1]?.src).toBe('/say/1')
    expect(clips[1]?.plays).toBe(1)
  })

  it('cancel is safe before anything has been queued', () => {
    const { voice } = harness()
    expect(() => voice.cancel()).not.toThrow()
  })
})
