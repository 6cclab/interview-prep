import { describe, expect, it, vi } from 'vitest'
import {
  checkSpeechEngine,
  ffplayArgs,
  isWhisperLogLine,
  parseWhisperOutput,
  piperArgs,
  piperSpeaker,
  resolveEngine,
  sayArgs,
  whisperArgs,
} from './speech'
import { transcriptionPrompt } from './vocabulary'

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
    expect(sayArgs('hello there')).toEqual(['--', 'hello there'])
  })

  it('adds -v for a voice', () => {
    expect(sayArgs('hello there', { voice: 'Alex' })).toEqual(['-v', 'Alex', '--', 'hello there'])
  })

  it('adds -r for a rate', () => {
    expect(sayArgs('hello there', { rate: 200 })).toEqual(['-r', '200', '--', 'hello there'])
  })

  it('adds -a for an audio device, routing the interviewer to a chosen output', () => {
    expect(sayArgs('hello there', { audioDevice: '75' })).toEqual(['-a', '75', '--', 'hello there'])
  })

  it('combines voice, rate, and audio device, text always last', () => {
    expect(sayArgs('hello there', { voice: 'Alex', rate: 200, audioDevice: '75' })).toEqual([
      '-v', 'Alex',
      '-r', '200',
      '-a', '75',
      '--',
      'hello there',
    ])
  })
})

/**
 * `--prompt` is whisper.cpp's initial-prompt hook, and it was unused: a real
 * drill transcript recorded "O of n" as "on" twice and "N" as "M", and the
 * interviewer marked him down for the second one. Asserted on the argv rather
 * than by spawning whisper — running it would be testing third-party software.
 */
describe('whisperArgs', () => {
  it('passes the model, the file, English and no prints', () => {
    expect(whisperArgs('models/x.bin', '/tmp/a.wav')).toEqual([
      '--model',
      'models/x.bin',
      '--file',
      '/tmp/a.wav',
      '--language',
      'en',
      '--no-prints',
    ])
  })

  it('appends --prompt when there is a vocabulary to bias toward', () => {
    const args = whisperArgs('m.bin', '/tmp/a.wav', 'O of n, O of one.')
    expect(args.slice(-2)).toEqual(['--prompt', 'O of n, O of one.'])
  })

  // An empty initial prompt is not the same input as no initial prompt, and
  // there is no reason to discover how this build treats it.
  it.each([undefined, '', '   '])('omits --prompt entirely for %j', (prompt) => {
    expect(whisperArgs('m.bin', '/tmp/a.wav', prompt)).not.toContain('--prompt')
  })

  it('keeps the prompt as one argv entry, however many commas it holds', () => {
    const prompt = transcriptionPrompt('design')
    const args = whisperArgs('m.bin', '/tmp/a.wav', prompt)
    expect(args.filter((arg) => arg === '--prompt')).toHaveLength(1)
    expect(args.at(-1)).toBe(prompt)
  })
})

describe('resolveEngine', () => {
  it('defaults to say on macOS and piper elsewhere', () => {
    expect(resolveEngine({}, 'darwin')).toBe('say')
    expect(resolveEngine({}, 'linux')).toBe('piper')
    expect(resolveEngine({}, 'win32')).toBe('piper')
  })

  // Explicit choice beats platform, the same stance backend.ts takes: nothing
  // here sniffs and switches silently.
  it('lets SAY_ENGINE override the platform in both directions', () => {
    expect(resolveEngine({ SAY_ENGINE: 'piper' }, 'darwin')).toBe('piper')
    expect(resolveEngine({ SAY_ENGINE: 'say' }, 'linux')).toBe('say')
  })

  it('throws on an unknown engine rather than falling back', () => {
    expect(() => resolveEngine({ SAY_ENGINE: 'festival' }, 'linux')).toThrow(/SAY_ENGINE/)
  })

  it('treats an empty value as unset, so a stale export can be cleared', () => {
    expect(resolveEngine({ SAY_ENGINE: '  ' }, 'darwin')).toBe('say')
  })
})

describe('piperArgs', () => {
  it('writes raw audio to stdout so it can be piped without a temp file', () => {
    expect(piperArgs({})).toContain('--output_raw')
  })

  it('passes a model path through as the voice', () => {
    expect(piperArgs({ voice: '/models/en_GB-alba-medium.onnx' })).toEqual(
      expect.arrayContaining(['--model', '/models/en_GB-alba-medium.onnx']),
    )
  })

  // `rate` means words-per-minute to `say` and length-scale to piper, where
  // higher is slower. A drill configured at 160 wpm must not become a
  // 160x-length-scale utterance.
  it('converts a say rate into a piper length scale', () => {
    const args = piperArgs({ rate: 180 })
    const scale = Number(args[args.indexOf('--length_scale') + 1])
    expect(scale).toBeGreaterThan(0.5)
    expect(scale).toBeLessThan(1.5)
  })

  it('omits length scale entirely when no rate is configured', () => {
    expect(piperArgs({})).not.toContain('--length_scale')
  })
})

describe('ffplayArgs', () => {
  it('plays 22.05kHz mono PCM from stdin with no window', () => {
    const args = ffplayArgs()
    expect(args).toEqual(expect.arrayContaining(['-nodisp', '-autoexit', '-']))
    expect(args).toEqual(expect.arrayContaining(['-f', 's16le']))
  })
})

/**
 * `piper` is not installed on this machine (checked: `which piper` finds
 * nothing) while `ffplay` is, so this exercises the real spawn-failure path
 * rather than a mock of it: piper ENOENTs while ffplay is alive with an open
 * stdin. This pins the observed behaviour — `speak` rejects naming piper,
 * rather than hanging (ffplay waiting on stdin forever) or crashing the
 * process (an unhandled stream 'error' event). The explicit test timeout
 * means a regression that hangs fails the test instead of stalling the suite.
 */
describe('piperSpeaker', () => {
  it('rejects, naming piper, when piper fails to spawn — instead of hanging or crashing', async () => {
    await expect(piperSpeaker({}).speak('hello')).rejects.toThrow(/piper/i)
  }, 10_000)
})

describe('checkSpeechEngine', () => {
  it('names the missing binary and the variable that would avoid it', () => {
    expect(() => checkSpeechEngine({ SAY_ENGINE: 'piper', PATH: '/nonexistent' }, 'linux'))
      .toThrow(/piper.*SAY_ENGINE/s)
  })
})

describe('sayArgs and text that looks like a flag', () => {
  // Measured 2026-08-12: a live drill lost two consecutive interviewer replies
  // because `say` exited 1 on a sentence starting with a hyphen — the model had
  // emitted markdown bullets, which its prompt forbids but which it produced
  // anyway. A dropped sentence is silent: the candidate simply never hears it.
  it('puts the text after `--` so a leading hyphen cannot be read as an option', () => {
    expect(sayArgs('- first, walk me through your approach')).toEqual([
      '--',
      '- first, walk me through your approach',
    ])
  })

  it('keeps `--` last, after every option', () => {
    const args = sayArgs('-x', { voice: 'Ava', rate: 180, audioDevice: '75' })
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toBe('-x')
  })
})
