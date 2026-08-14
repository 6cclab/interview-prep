import { describe, expect, it } from 'vitest'
import { browserSpeaker, type Synth } from './speak'

function fakeSynth() {
  const said: string[] = []
  let cancelled = 0
  const synth: Synth = {
    speak: (u) => said.push((u as unknown as { text: string }).text),
    cancel: () => {
      cancelled += 1
    },
  }
  return { synth, said, cancels: () => cancelled }
}

const utter = (text: string) => ({ text }) as unknown as SpeechSynthesisUtterance

describe('browserSpeaker', () => {
  it('says a sentence', () => {
    const { synth, said } = fakeSynth()
    browserSpeaker(synth, utter)!.say('Tell me about a time you disagreed.')
    expect(said).toEqual(['Tell me about a time you disagreed.'])
  })

  // An empty utterance still occupies the queue, so the next real sentence
  // waits behind a silence for no reason.
  it('does not queue an empty sentence', () => {
    const { synth, said } = fakeSynth()
    const speaker = browserSpeaker(synth, utter)!
    speaker.say('   ')
    speaker.say('')
    expect(said).toEqual([])
  })

  // Ending a session leaves whatever is queued still to be said, and it would
  // carry on talking over whatever screen comes next.
  it('drops anything still queued when it is stopped', () => {
    const { synth, cancels } = fakeSynth()
    browserSpeaker(synth, utter)!.stop()
    expect(cancels()).toBe(1)
  })

  // Null rather than a no-op: a no-op would present a mute drill as a working
  // one, and the caller is the only thing that can decide what to say about it.
  it('is null where the browser cannot speak at all', () => {
    expect(browserSpeaker(undefined, utter)).toBeNull()
  })
})
