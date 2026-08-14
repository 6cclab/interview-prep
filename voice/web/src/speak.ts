/**
 * Saying the interviewer's words in this browser.
 *
 * Only a deployed instance needs it. A local one is the machine you are sitting
 * at, so `voice/speech.ts` speaks there with a real voice — `say` or piper —
 * and this would be a second, worse voice talking over it.
 *
 * The browser's own synthesis is the interim answer, and it is a downgrade:
 * the local path uses a chosen voice at a chosen rate. Streaming piper's audio
 * to the browser keeps that quality and is a protocol change to `streamTurn`.
 */

/** The slice of `speechSynthesis` used here, so a test can supply one. */
export interface Synth {
  speak(utterance: SpeechSynthesisUtterance): void
  cancel(): void
}

export interface Speaker {
  say(text: string): void
  stop(): void
}

/**
 * A speaker, or null where the browser has no synthesis at all.
 *
 * Null rather than a silent no-op object: the caller decides what a browser
 * that cannot speak should do, and a no-op would present a mute drill as a
 * working one.
 */
export function browserSpeaker(
  synth: Synth | undefined = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis,
  makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
): Speaker | null {
  if (synth === undefined) return null
  return {
    say(text) {
      const trimmed = text.trim()
      // An empty utterance still occupies the queue and delays the next real
      // sentence behind it.
      if (trimmed === '') return
      synth.speak(makeUtterance(trimmed))
    },
    stop() {
      // Ending a session leaves whatever is queued still to be said, and it
      // would carry on talking over the next screen.
      synth.cancel()
    },
  }
}
