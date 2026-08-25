import { describe, expect, it } from 'vitest'
import type { StreamFn } from './interviewer'
import { liveSummaryPrompt, summarise, summaryUserMessage } from './live-summary'

const req = {
  company: 'Talkspace',
  round: 'technical screen',
  mode: 'live' as const,
  transcript: '[00:00:00] So the brute force is n squared.',
}

function streamOf(...chunks: string[]): StreamFn {
  return async function* () {
    for (const chunk of chunks) yield chunk
  }
}

describe('liveSummaryPrompt', () => {
  const prompt = liveSummaryPrompt(process.cwd())

  /**
   * The section the artifact has a slot for, and the one the prompt has to name
   * exactly — `splitSummary` finds it by heading. If this file's heading and
   * that regex ever drift apart, the whole section lands in the summary body and
   * the artifact reports it as missing.
   */
  it('asks for the open-questions section by the heading the parser looks for', () => {
    expect(prompt).toContain('## Open questions')
  })

  it('states the one-microphone limit and the heard/inferred distinction', () => {
    expect(prompt).toMatch(/one microphone/i)
    expect(prompt).toContain('heard')
    expect(prompt).toContain('inferred')
  })

  it('covers all four parts the record is for', () => {
    expect(prompt).toContain('### Questions asked')
    expect(prompt).toContain('### Where he stalled')
    expect(prompt).toContain('### Narrated versus only did')
    expect(prompt).toContain('### What he is now on the hook for')
  })

  // Same substitution every other prompt gets; a leftover token in a real
  // record reads as a bug in the tool that produced it.
  it('leaves no template token behind', () => {
    expect(prompt).not.toContain('{{candidate}}')
  })
})

describe('summaryUserMessage', () => {
  it('carries the round it is summarising', () => {
    const body = summaryUserMessage(req)
    expect(body).toContain('Company: Talkspace')
    expect(body).toContain('Round: technical screen')
    expect(body).toContain('[00:00:00] So the brute force is n squared.')
  })

  /**
   * A debrief is a paraphrase spoken from memory. A model told nothing would
   * quote it as if it were said in the room — putting invented verbatim into
   * the one record that exists of the round.
   */
  it('tells the model which of the two it is reading', () => {
    expect(summaryUserMessage(req)).toMatch(/live capture/i)
    const debrief = summaryUserMessage({ ...req, mode: 'debrief' })
    expect(debrief).toMatch(/from memory/i)
    expect(debrief).toMatch(/paraphrase/i)
  })

  it('repeats the one-sided limit alongside the transcript', () => {
    expect(summaryUserMessage(req)).toMatch(/interviewer is not in this transcript/i)
  })
})

describe('summarise', () => {
  it('splits the reply into the artifact’s two sections', async () => {
    const stream = streamOf('He named the complexity.\n\n## Open questions\n\n- Was a hint given?')
    const summary = await summarise(stream, 'system', req)
    expect(summary?.summary).toBe('He named the complexity.')
    expect(summary?.openQuestions).toBe('- Was a hint given?')
  })

  it('assembles a streamed reply before splitting it', async () => {
    const stream = streamOf('He named ', 'the complexity.\n\n## Open ', 'questions\n\n- x')
    expect((await summarise(stream, 'system', req))?.openQuestions).toBe('- x')
  })

  /**
   * The transcript is already captured by the time this runs and is the thing
   * worth keeping. Failing the command over an unreachable model would throw
   * away a recorded round because ollama was down — the exact loss `/live`
   * exists to prevent.
   */
  it('returns nothing rather than throwing when the model is unreachable', async () => {
    const stream: StreamFn = async function* () {
      throw new Error('ECONNREFUSED')
    }
    await expect(summarise(stream, 'system', req)).resolves.toBeNull()
  })

  it('treats an empty reply as no summary', async () => {
    expect(await summarise(streamOf('', '   \n'), 'system', req)).toBeNull()
  })
})
