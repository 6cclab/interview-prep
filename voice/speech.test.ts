import { describe, expect, it } from 'vitest'
import { parseWhisperOutput } from './speech'

describe('parseWhisperOutput', () => {
  it('joins timestamped segments into one utterance', () => {
    const stdout = [
      '[00:00:00.000 --> 00:00:03.240]   So the first thing I want to pin down',
      '[00:00:03.240 --> 00:00:06.100]   is the read to write ratio.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe(
      'So the first thing I want to pin down is the read to write ratio.',
    )
  })

  it('keeps filler and false starts verbatim', () => {
    const stdout = '[00:00:00.000 --> 00:00:02.000]   Um, so, I guess I would, uh, shard it.'
    expect(parseWhisperOutput(stdout).text).toBe('Um, so, I guess I would, uh, shard it.')
  })

  it('ignores non-segment log lines', () => {
    const stdout = [
      'whisper_init_from_file_with_params_no_state: loading model',
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency.')
  })

  it('returns empty text for a silent recording', () => {
    expect(parseWhisperOutput('').text).toBe('')
  })
})
