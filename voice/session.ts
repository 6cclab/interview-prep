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
 * One drill, start to finish. The interviewer speaks first; after that every
 * cycle is: record until Andre yields, transcribe, reply, speak the reply.
 */
export async function runSession(deps: SessionDeps): Promise<Entry[]> {
  const entries: Entry[] = []
  let said = OPENING

  for (;;) {
    const at = deps.now()
    const spoken: string[] = []
    for await (const sentence of deps.interviewer.turn(said)) {
      spoken.push(sentence)
      await deps.speaker.speak(sentence)
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
