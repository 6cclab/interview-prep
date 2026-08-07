import type { Recorder } from './audio'
import type { Interviewer } from './interviewer'
import type { Speaker, Transcriber } from './speech'
import type { Entry } from './transcript'

export interface SessionDeps {
  transcriber: Transcriber
  speaker: Speaker
  interviewer: Interviewer
  startRecording(): Recorder
  /** Resolves when Andre yields the turn, or 'end' to finish the session. */
  nextTurn(): Promise<'speak' | 'end'>
  /** Milliseconds since the session started. */
  now(): number
}

const OPENING = 'Begin the interview.'

/**
 * `runSession`'s normal return value, widened with an optional marker. A mid-
 * session turn failure ends the session early rather than throwing, so the
 * entries collected so far still reach the caller (and the transcript still
 * gets written). `endedEarly` is how that caller can tell this apart from a
 * normal end — set on the array itself so callers that only care about the
 * entries (like `cli.ts`) can keep treating the return value as `Entry[]`.
 */
export type SessionOutcome = Entry[] & { endedEarly?: string }

/**
 * One drill, start to finish. The interviewer speaks first; after that every
 * cycle is: record until Andre yields, transcribe, reply, speak the reply.
 *
 * `interviewer.turn()` throws on a stream failure or an empty reply, and
 * rolls back its own message history when it does. There is no retry policy
 * here — that's a decision nobody has made — so a failed turn simply ends the
 * session: the entries already collected are returned (not discarded), a
 * synthetic entry marks roughly where it happened, and `endedEarly` is set so
 * this can't be mistaken for a normal end.
 */
export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  const entries: SessionOutcome = []
  let said = OPENING

  for (;;) {
    const at = deps.now()
    const spoken: string[] = []
    try {
      for await (const sentence of deps.interviewer.turn(said)) {
        spoken.push(sentence)
        await deps.speaker.speak(sentence)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entries.push({
        speaker: 'interviewer',
        text: `[Session ended early — ${message}]`,
        at,
      })
      entries.endedEarly = message
      console.error(`Voice session ended early: ${message}`)
      return entries
    }
    entries.push({ speaker: 'interviewer', text: spoken.join(' '), at })

    const recorder = deps.startRecording()
    const decision = await deps.nextTurn()
    const wavPath = await recorder.stop()
    if (decision === 'end') return entries

    const heardAt = deps.now()
    const utterance = await deps.transcriber.transcribe(wavPath)
    entries.push({ speaker: 'andre', text: utterance.text, at: heardAt })
    said = utterance.text
  }
}
