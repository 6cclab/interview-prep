import { describe, expect, it } from 'vitest'
import { createBrowserVoice, pickVoice, type SpeechEngine } from './browserVoice'

// `SpeechSynthesisVoice` is a browser interface with no constructor, and the
// harness runs in node. Only the four fields `pickVoice` reads matter.
function voice(lang: string, localService: boolean, isDefault = false, name = lang): SpeechSynthesisVoice {
  return { lang, localService, default: isDefault, name, voiceURI: name } as SpeechSynthesisVoice
}

interface FakeEngine extends SpeechEngine {
  spoken: SpeechSynthesisUtterance[]
  cancels: number
  listeners: (() => void)[]
  voices: SpeechSynthesisVoice[]
}

function fakeEngine(voices: SpeechSynthesisVoice[] = []): FakeEngine {
  const engine: FakeEngine = {
    spoken: [],
    cancels: 0,
    listeners: [],
    voices,
    speak: (utterance) => {
      engine.spoken.push(utterance)
    },
    cancel: () => {
      engine.cancels += 1
    },
    getVoices: () => engine.voices,
    addEventListener: (_type, listener) => {
      engine.listeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      engine.listeners = engine.listeners.filter((l) => l !== listener)
    },
  }
  return engine
}

// A stand-in for `new SpeechSynthesisUtterance(text)`, which node has no
// constructor for. Only `text`, `voice` and `lang` are ever read back.
const utteranceFactory = (text: string): SpeechSynthesisUtterance =>
  ({ text, voice: null, lang: '' }) as SpeechSynthesisUtterance

describe('pickVoice', () => {
  it('returns null when nothing on the platform speaks English', () => {
    expect(pickVoice([voice('de-DE', true), voice('ja-JP', true)])).toBeNull()
  })

  it('prefers the local default English voice over a local non-default one', () => {
    const wanted = voice('en-US', true, true, 'Samantha')
    expect(pickVoice([voice('en-GB', true, false, 'Daniel'), wanted])?.name).toBe('Samantha')
  })

  // Remote voices are the ones that stall mid-drill waiting on a network round
  // trip, so a local non-default beats a remote default.
  it('prefers any local English voice over a remote one, even the remote default', () => {
    const remoteDefault = voice('en-US', false, true, 'Google US English')
    const localPlain = voice('en-AU', true, false, 'Karen')
    expect(pickVoice([remoteDefault, localPlain])?.name).toBe('Karen')
  })

  it('falls back to a remote English voice rather than staying silent', () => {
    expect(pickVoice([voice('en-US', false, false, 'Google US English')])?.name).toBe('Google US English')
  })

  it('matches on the language subtag, so en-GB and en-AU both count as English', () => {
    expect(pickVoice([voice('en-AU', true)])).not.toBeNull()
    expect(pickVoice([voice('EN-gb', true)])).not.toBeNull()
  })
})

describe('createBrowserVoice', () => {
  it('reports unsupported and stays silent when the platform has no speech engine', () => {
    const speech = createBrowserVoice(null, utteranceFactory)
    expect(speech.supported).toBe(false)
    // The point is that none of these throw — every call site is unconditional.
    speech.speak('hello')
    speech.cancel()
    speech.dispose()
  })

  it('speaks each sentence in the order it was handed them', () => {
    const engine = fakeEngine([voice('en-US', true, true)])
    const speech = createBrowserVoice(engine, utteranceFactory)
    speech.speak('first')
    speech.speak('second')
    expect(engine.spoken.map((u) => u.text)).toEqual(['first', 'second'])
  })

  it('sets the chosen voice and its language together', () => {
    const engine = fakeEngine([voice('en-GB', true, true, 'Daniel')])
    createBrowserVoice(engine, utteranceFactory).speak('hello')
    expect(engine.spoken[0]?.voice?.name).toBe('Daniel')
    expect(engine.spoken[0]?.lang).toBe('en-GB')
  })

  // Chromium returns an empty list from the first `getVoices()` and announces
  // the real one asynchronously. Caching that empty result means the first
  // sentence of every session gets the platform default.
  it('picks up voices that only arrive with voiceschanged', () => {
    const engine = fakeEngine([])
    const speech = createBrowserVoice(engine, utteranceFactory)
    speech.speak('too early')
    expect(engine.spoken[0]?.voice).toBeNull()

    engine.voices = [voice('en-US', true, true, 'Samantha')]
    for (const listener of engine.listeners) listener()
    speech.speak('now')
    expect(engine.spoken[1]?.voice?.name).toBe('Samantha')
  })

  it('queues nothing for an empty or whitespace-only sentence', () => {
    const engine = fakeEngine([voice('en-US', true, true)])
    const speech = createBrowserVoice(engine, utteranceFactory)
    speech.speak('')
    speech.speak('   \n ')
    expect(engine.spoken).toEqual([])
  })

  it('trims the sentence it speaks', () => {
    const engine = fakeEngine([voice('en-US', true, true)])
    createBrowserVoice(engine, utteranceFactory).speak('  hello  ')
    expect(engine.spoken[0]?.text).toBe('hello')
  })

  it('cancels through to the engine', () => {
    const engine = fakeEngine()
    createBrowserVoice(engine, utteranceFactory).cancel()
    expect(engine.cancels).toBe(1)
  })

  it('detaches its voiceschanged listener on dispose', () => {
    const engine = fakeEngine()
    const speech = createBrowserVoice(engine, utteranceFactory)
    expect(engine.listeners).toHaveLength(1)
    speech.dispose()
    expect(engine.listeners).toHaveLength(0)
  })
})
