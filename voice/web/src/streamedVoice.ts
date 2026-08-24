/**
 * The interviewer's voice, synthesised on the server and played here.
 *
 * The third of three arrangements (see `GET /api/devices/output`'s `speech`
 * field). The server plays its own audio when it is the machine the candidate
 * is sitting at; it streams the bytes here when it is not; and `browserVoice.ts`
 * is the fallback when it cannot synthesise at all. This is the middle one, and
 * the one worth preferring when it is available: the voice is the same for
 * everyone, where `SpeechSynthesis` is a lottery per browser and operating
 * system — Chrome on Linux frequently has no local English voice at all.
 *
 * Unlike `SpeechSynthesis`, `<audio>` does not queue. Two `play()` calls
 * overlap, so the queue below is not optional the way it was there: it is the
 * only thing standing between a fast reply and two sentences at once.
 */

/** What an `<audio>` element needs to be, for a test to supply one. */
export interface AudioClip {
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  src: string
}

export interface StreamedVoice {
  /** Queues one sentence's audio. Plays when everything before it has finished. */
  speak(url: string): void
  /** Stops immediately and drops the queue. */
  cancel(): void
}

/**
 * `clipFor` exists so a test can stand in for `new Audio(url)` — a browser
 * global, and one that would really try to fetch.
 */
export function createStreamedVoice(clipFor: (url: string) => AudioClip): StreamedVoice {
  const queue: string[] = []
  let playing: AudioClip | null = null

  const playNext = (): void => {
    const url = queue.shift()
    if (url === undefined) {
      playing = null
      return
    }
    const clip = clipFor(url)
    playing = clip
    // Both paths advance the queue. A sentence whose synthesis failed must not
    // wedge every sentence after it: a 500 from the audio route should cost the
    // one sentence, and the drill carries on with the text on screen.
    clip.addEventListener('ended', () => {
      if (playing === clip) playNext()
    })
    clip.addEventListener('error', () => {
      if (playing === clip) playNext()
    })
    void clip.play().catch(() => {
      // Autoplay policy, most likely — a browser will refuse audio on a page
      // that has had no user gesture. Starting a drill is a click, so this
      // should not happen in practice, and if it does the text is still there.
      if (playing === clip) playNext()
    })
  }

  return {
    speak(url: string): void {
      queue.push(url)
      // Only kick the queue when nothing is playing; otherwise the `ended`
      // handler above will get to it, and starting here as well would play two
      // clips at once — the exact failure this queue exists to prevent.
      if (!playing) playNext()
    },
    cancel(): void {
      queue.length = 0
      const clip = playing
      playing = null
      // After clearing `playing`, so the `ended` this may fire finds a stale
      // clip and declines to advance into a queue that is being torn down.
      clip?.pause()
    },
  }
}

/** `new Audio(url)`, or null where there is no DOM. */
export function platformClip(url: string): AudioClip {
  return new Audio(url)
}
