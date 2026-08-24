/**
 * The browser's own voice.
 *
 * Locally the *server* speaks: `SpeechSynthesis` exposes no output-device API,
 * so a browser cannot honour the speaker the candidate picked, and the server
 * is the same machine anyway. Deployed, that reasoning collapses — the server
 * is in a datacentre and the sentences would come out of a machine with nobody
 * in front of it. So the browser speaks instead, and `serverSpeaks` from
 * `GET /api/devices/output` decides which of the two it is. Exactly one of them
 * speaks; both speaking is two overlapping voices half a second apart, which is
 * worse than either alone.
 *
 * `speechSynthesis.speak` already queues and never overlaps, so there is no
 * queue here — a second queue on top of the platform's would only be able to
 * disagree with it. What this module adds is voice selection (which is
 * asynchronous in a way that is easy to get wrong), a `cancel` that is safe to
 * call at any time, and a shape that can be handed a fake in a test.
 */

/** The slice of `SpeechSynthesis` this needs — the whole interface is not mockable by hand. */
export interface SpeechEngine {
  speak(utterance: SpeechSynthesisUtterance): void
  cancel(): void
  getVoices(): SpeechSynthesisVoice[]
  addEventListener(type: 'voiceschanged', listener: () => void): void
  removeEventListener(type: 'voiceschanged', listener: () => void): void
}

export interface BrowserVoice {
  /** False when the platform has no `speechSynthesis` at all. `speak` is then a no-op. */
  readonly supported: boolean
  /** Speaks one sentence, after everything already queued. */
  speak(text: string): void
  /** Drops everything queued and stops mid-word. Safe before anything has been spoken. */
  cancel(): void
  /** Detaches the `voiceschanged` listener. */
  dispose(): void
}

/**
 * Chrome ships dozens of remote voices whose `lang` is some other locale, and
 * the default pick is whatever the platform decides — which on a machine with
 * a non-English system language is an English sentence read with the wrong
 * phonology. Prefer a local (offline) English voice: local ones start
 * immediately and keep working without network, and the remote ones are the
 * ones that stall mid-drill.
 */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (english.length === 0) return null
  return english.find((v) => v.localService && v.default) ?? english.find((v) => v.localService) ?? english[0] ?? null
}

/**
 * `utteranceFactory` exists only so tests can construct an utterance without a
 * DOM — `SpeechSynthesisUtterance` is a browser global, not something jsdom
 * necessarily provides.
 */
export function createBrowserVoice(
  engine: SpeechEngine | null | undefined,
  utteranceFactory: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
): BrowserVoice {
  if (!engine) {
    return { supported: false, speak: () => {}, cancel: () => {}, dispose: () => {} }
  }

  // `getVoices()` is empty on first call in every Chromium browser — the list
  // is populated asynchronously and announced by `voiceschanged`. Reading it
  // once at construction and caching the empty result is the classic bug: the
  // first sentence of every session gets the platform default, and only the
  // second onwards gets the chosen voice.
  let voice = pickVoice(engine.getVoices())
  const onVoicesChanged = (): void => {
    voice = pickVoice(engine.getVoices())
  }
  engine.addEventListener('voiceschanged', onVoicesChanged)

  return {
    supported: true,
    speak(text: string): void {
      const trimmed = text.trim()
      // An empty utterance never fires `end` in Safari, which wedges the queue
      // behind it. Nothing to say is nothing to queue.
      if (!trimmed) return
      const utterance = utteranceFactory(trimmed)
      if (voice) {
        utterance.voice = voice
        // Set together with the voice: leaving `lang` at the document's
        // language while the voice is en-US makes some engines re-pick.
        utterance.lang = voice.lang
      }
      engine.speak(utterance)
    },
    cancel(): void {
      engine.cancel()
    },
    dispose(): void {
      engine.removeEventListener('voiceschanged', onVoicesChanged)
    },
  }
}

/** `window.speechSynthesis`, or null where there is no window (tests, SSR). */
export function platformSpeechEngine(): SpeechEngine | null {
  if (typeof window === 'undefined') return null
  const synth = window.speechSynthesis as SpeechEngine | undefined
  return synth ?? null
}
