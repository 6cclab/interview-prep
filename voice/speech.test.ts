import { describe, expect, it, vi } from 'vitest'
import { isWhisperLogLine, parseWhisperOutput, sayArgs } from './speech'

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

  it('does not warn when input is only segments and whisper log lines', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stdout = [
      'whisper_init_from_file_with_params_no_state: loading model',
      'whisper_model_load: n_vocab = 51866',
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
      'system_info: n_threads = 4',
      '[00:00:01.000 --> 00:00:02.000]   Write latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency. Write latency.')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns once, naming the line, on unrecognised non-empty content, but keeps recognised segments', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stdout = [
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
      'a line whisper never emits',
      '[00:00:01.000 --> 00:00:02.000]   Write latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency. Write latency.')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.join(' ')).toContain('a line whisper never emits')
    warn.mockRestore()
  })

  it('warns on a bracket-less prose-with-colon line rather than silently dropping it, but keeps recognised segments', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stdout = [
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
      'so the thing is: we shard by tenant',
      '[00:00:01.000 --> 00:00:02.000]   Write latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency. Write latency.')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.join(' ')).toContain('so the thing is: we shard by tenant')
    warn.mockRestore()
  })

  it('warns on a single-word-then-colon prose line rather than silently dropping it, but keeps recognised segments', () => {
    // This exact shape ('okay: so we shard by tenant') matched the old heuristic
    // /^[a-z_]+(\s*\([^)]*\))?:/ and would have been silently discarded as whisper
    // log noise. Reaching the warn path (not the silent-discard path) proves the
    // new allowlist no longer swallows it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stdout = [
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
      'okay: so we shard by tenant',
      '[00:00:01.000 --> 00:00:02.000]   Write latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency. Write latency.')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.join(' ')).toContain('okay: so we shard by tenant')
    warn.mockRestore()
  })
})

describe('isWhisperLogLine', () => {
  it('recognises whisper.cpp startup log lines and empty strings', () => {
    expect(isWhisperLogLine('whisper_init_from_file_with_params_no_state: loading model')).toBe(true)
    expect(isWhisperLogLine('whisper_model_load: n_vocab = 51866')).toBe(true)
    expect(isWhisperLogLine('system_info: n_threads = 4')).toBe(true)
    expect(isWhisperLogLine('')).toBe(true)
  })

  it('does not recognise plain transcribed prose', () => {
    expect(isWhisperLogLine('So the first thing I want to pin down is the ratio.')).toBe(false)
  })

  it('does not recognise a bracket-less prose line that ends its first clause with a colon', () => {
    expect(isWhisperLogLine('so the thing is: we shard by tenant')).toBe(false)
  })

  it('does not recognise a single lowercase word immediately followed by a colon', () => {
    // The previous heuristic (/^[a-z_]+(\s*\([^)]*\))?:/) matched exactly this
    // shape and would have silently discarded it as whisper log noise.
    expect(isWhisperLogLine('okay: so we shard by tenant')).toBe(false)
  })

  it('recognises a ggml log line', () => {
    expect(isWhisperLogLine('ggml_metal_init: allocating')).toBe(true)
  })
})

describe('sayArgs', () => {
  it('passes just the text when no options are given', () => {
    expect(sayArgs('hello there')).toEqual(['hello there'])
  })

  it('adds -v for a voice', () => {
    expect(sayArgs('hello there', { voice: 'Alex' })).toEqual(['-v', 'Alex', 'hello there'])
  })

  it('adds -r for a rate', () => {
    expect(sayArgs('hello there', { rate: 200 })).toEqual(['-r', '200', 'hello there'])
  })

  it('adds -a for an audio device, routing the interviewer to a chosen output', () => {
    expect(sayArgs('hello there', { audioDevice: '75' })).toEqual(['-a', '75', 'hello there'])
  })

  it('combines voice, rate, and audio device, text always last', () => {
    expect(sayArgs('hello there', { voice: 'Alex', rate: 200, audioDevice: '75' })).toEqual([
      '-v', 'Alex',
      '-r', '200',
      '-a', '75',
      'hello there',
    ])
  })
})
