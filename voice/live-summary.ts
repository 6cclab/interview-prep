import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCandidateName, renderCandidate } from './candidate'
import type { StreamFn } from './interviewer'
import { splitSummary, type LiveSummary } from './live-artifact'

/**
 * The summary half of `/live` — one turn against a model, no session.
 *
 * Deliberately not an `Interviewer`. There is no conversation here: one system
 * prompt, one transcript, one reply. Reusing `createInterviewer` would drag in
 * turn state, the sentence chunker and the drill-log trailer parser, none of
 * which apply to a document being read once.
 *
 * There is also deliberately no `'live'` `Track`. `Track` drives `allowedPaths`
 * and the spoiler gate; a real interview has no spoilable answer and no agent to
 * fence, so an eighth track would mean threading `'live'` through that machinery
 * to buy nothing. The backend and model come from the caller instead — the CLI
 * passes the `coach` track's, since coach is the existing "look back at how it
 * went" surface and `VOICE_BACKEND_COACH` / `VOICE_MODEL_COACH` are the knobs
 * someone would reach for anyway.
 */

export function liveSummaryPrompt(root: string): string {
  const text = readFileSync(join(root, 'prompts/live-summary.md'), 'utf8')
  return renderCandidate(text, readCandidateName(root))
}

export interface SummaryRequest {
  company: string
  round: string
  /** `live` reads as a recording; `debrief` reads as a memory. The model is told which. */
  mode: 'live' | 'debrief'
  transcript: string
}

/**
 * What the model is handed. Kept separate from the system prompt so the framing
 * that changes per round travels with the transcript rather than being baked
 * into a file — and so `mode` is stated rather than implied. A debrief is a
 * recollection spoken into a microphone five minutes later, and a model that
 * reads one as a verbatim capture will quote a paraphrase as if it were said.
 */
export function summaryUserMessage(req: SummaryRequest): string {
  const provenance =
    req.mode === 'live'
      ? 'This is a live capture: the words below were spoken during the round and transcribed by whisper.'
      : 'This is a debrief: he spoke this into a microphone shortly after the round, from memory. ' +
        'Treat every quoted question as a paraphrase — nothing here is verbatim, including what looks verbatim.'

  return [
    `Company: ${req.company}`,
    `Round: ${req.round}`,
    '',
    provenance,
    'Only his microphone was recorded. The interviewer is not in this transcript.',
    '',
    '---',
    '',
    req.transcript,
  ].join('\n')
}

/**
 * Run the summary and split it into the artifact's two sections.
 *
 * Returns `null` rather than throwing when the model is unreachable or returns
 * nothing. By the time this runs the transcript is already in hand and is the
 * thing worth keeping; failing the whole command over an absent summary would
 * throw away a captured round because a model was down — which is precisely the
 * loss `/live` exists to prevent. The caller writes the artifact either way, and
 * `formatArtifact` says on the page that no summary was generated.
 */
export async function summarise(
  stream: StreamFn,
  system: string,
  req: SummaryRequest,
): Promise<LiveSummary | null> {
  let reply = ''
  try {
    for await (const chunk of stream(system, [{ role: 'user', content: summaryUserMessage(req) }])) {
      reply += chunk
    }
  } catch {
    return null
  }
  return reply.trim() === '' ? null : splitSummary(reply)
}
