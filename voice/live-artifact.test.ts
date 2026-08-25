import { describe, expect, it } from 'vitest'
import {
  formatArtifact,
  formatDuration,
  formatTranscript,
  splitSummary,
  stamp,
  stripSummaryHeading,
  type LiveHeader,
} from './live-artifact'

describe('formatDuration', () => {
  it.each([
    [0, '0m'],
    [47 * 60_000, '47m'],
    [72 * 60_000, '1h 12m'],
    [60 * 60_000, '1h 0m'],
  ])('%i ms reads as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  // A clock that went backwards should not put "-1m" in the header of a record.
  it('never reports negative time', () => {
    expect(formatDuration(-5000)).toBe('0m')
  })
})

describe('stamp', () => {
  it.each([
    [0, '[00:00:00]'],
    [300_000, '[00:05:00]'],
    [3_600_000, '[01:00:00]'],
    [3_725_000, '[01:02:05]'],
  ])('%i ms stamps as %s', (ms, expected) => {
    expect(stamp(ms)).toBe(expected)
  })
})

describe('splitSummary', () => {
  it('splits on the open-questions heading', () => {
    const { summary, openQuestions } = splitSummary(
      'He was asked about sharding.\n\n## Open questions\n\n- Whether the follow-up landed.',
    )
    expect(summary).toBe('He was asked about sharding.')
    expect(openQuestions).toBe('- Whether the follow-up landed.')
  })

  it('accepts any heading level and any case', () => {
    expect(splitSummary('a\n### OPEN QUESTIONS\nb').openQuestions).toBe('b')
  })

  /**
   * The tolerant half. A local model that returns one section, or heads it
   * differently, must not cost us its output — by the time this runs the
   * recording is gone and this text is the whole record.
   */
  it('keeps everything as the summary when the heading never arrives', () => {
    const reply = 'A summary with no second section at all.'
    expect(splitSummary(reply)).toEqual({ summary: reply, openQuestions: null })
  })

  // A heading with nothing under it is the same as no section — and the
  // artifact says so rather than rendering a bare heading.
  it('treats an empty section as absent', () => {
    expect(splitSummary('a\n## Open questions\n\n   ').openQuestions).toBeNull()
  })

  it('does not split on the phrase appearing in prose', () => {
    const reply = 'He left some open questions about the index.'
    expect(splitSummary(reply).openQuestions).toBeNull()
  })
})

describe('stripSummaryHeading', () => {
  it('removes a heading the model added itself', () => {
    expect(stripSummaryHeading('## Summary\n\nHe did fine.')).toBe('He did fine.')
  })

  it('leaves a body that has no heading alone', () => {
    expect(stripSummaryHeading('He did fine.')).toBe('He did fine.')
  })

  // Only the leading one. A "## Summary of the design" heading further down is
  // the model's own structure and belongs in the record.
  it('does not strip a later heading', () => {
    expect(stripSummaryHeading('He did fine.\n\n## Summary of the design\n\nx')).toContain(
      '## Summary of the design',
    )
  })
})

describe('formatTranscript', () => {
  it('stamps each segment with where it began', () => {
    const body = formatTranscript([
      { offsetMs: 0, text: 'So the brute force is n squared.' },
      { offsetMs: 300_000, text: 'I would use a hash map here.' },
    ])
    expect(body).toContain('[00:00:00] So the brute force is n squared.')
    expect(body).toContain('[00:05:00] I would use a hash map here.')
  })

  /**
   * Silence is data. The summary is asked where he stalled, and dropping a
   * silent five minutes would make the record claim a shorter round than
   * happened — and hide the stall it is meant to surface.
   */
  it('marks a silent segment rather than dropping it', () => {
    const body = formatTranscript([
      { offsetMs: 0, text: 'ok' },
      { offsetMs: 300_000, text: '   ' },
      { offsetMs: 600_000, text: 'right' },
    ])
    expect(body).toContain('[00:05:00] _(silence)_')
    expect(body.split('\n\n')).toHaveLength(3)
  })

  it('says so when nothing was transcribed', () => {
    expect(formatTranscript([])).toContain('Nothing was transcribed')
  })
})

describe('formatArtifact', () => {
  const header: LiveHeader = {
    company: 'Talkspace',
    round: 'technical screen',
    mode: 'live',
    startedAt: new Date('2026-08-28T18:30:00Z'),
    durationMs: 47 * 60_000,
    device: 'MacBook Pro Microphone',
    model: 'qwen3.8:latest',
  }

  it('heads the record with company, round and date', () => {
    expect(formatArtifact(header, null, 'x')).toContain(
      '# Talkspace — technical screen, 2026-08-28',
    )
  })

  it('records how the text was produced', () => {
    const out = formatArtifact(header, null, 'x')
    expect(out).toContain('mode: live')
    expect(out).toContain('duration: 47m')
    expect(out).toContain('device: MacBook Pro Microphone')
    expect(out).toContain('model: qwen3.8:latest')
  })

  /**
   * `mode` earns its line. A debrief is a memory five minutes old and a live is
   * a recording; reading one as the other is the exact error this tool exists
   * to stop, and months later the header is all there is to tell them apart.
   */
  it('distinguishes a debrief from a capture', () => {
    expect(formatArtifact({ ...header, mode: 'debrief' }, null, 'x')).toContain('mode: debrief')
  })

  it('always carries the transcript, summary or no summary', () => {
    const out = formatArtifact(header, null, '[00:00:00] said a thing')
    expect(out).toContain('[00:00:00] said a thing')
    expect(out).toContain('No summary was generated')
  })

  /**
   * The section most likely to go missing, and the one whose absence changes
   * how the rest should be read. A blank heading here would say "nothing was
   * missing", which is never true of one side of a conversation.
   */
  it('names a missing open-questions section instead of leaving it blank', () => {
    const out = formatArtifact(header, { summary: 'He did fine.', openQuestions: null }, 'x')
    expect(out).toContain('## Open questions')
    expect(out).toMatch(/did not list what it could not determine/)
  })

  it('renders both sections when the model supplied them', () => {
    const out = formatArtifact(
      header,
      { summary: 'He did fine.', openQuestions: '- Did the follow-up land?' },
      '[00:00:00] x',
    )
    expect(out).toContain('He did fine.')
    expect(out).toContain('- Did the follow-up land?')
    expect(out).not.toMatch(/did not list what it could not determine/)
  })

  // The heading says it, every time, so nobody reads the transcript as a record
  // of what the interviewer said.
  it('labels the transcript as one-sided', () => {
    expect(formatArtifact(header, null, 'x')).toContain('## Transcript (own microphone only)')
  })

  it('does not leave a doubled heading when the model supplied its own', () => {
    const out = formatArtifact(header, { summary: '## Summary\n\nHe did fine.', openQuestions: null }, 'x')
    expect(out.match(/## Summary/g)).toHaveLength(1)
  })
})
