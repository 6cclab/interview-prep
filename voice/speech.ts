import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Utterance {
  text: string
}

export interface Transcriber {
  transcribe(wavPath: string): Promise<Utterance>
}

export interface Speaker {
  speak(text: string): Promise<void>
}

const SEGMENT = /^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.*)$/

// whisper.cpp's own startup/diagnostic log lines, e.g.
// `whisper_init_from_file_with_params_no_state: loading model`,
// `whisper_model_load: n_vocab = 51866`, `system_info: n_threads = 4`,
// `ggml_metal_init: allocating`. An allowlist of its real prefixes, rather
// than a generic "identifier followed by colon" shape: the generic shape
// also matches ordinary prose that happens to contain a colon (e.g.
// "so the thing is: we shard by tenant"), which would silently discard real
// speech — the worst failure mode this module can have. An empty line is
// also noise.
const WHISPER_LOG_LINE = /^(whisper_|ggml_|system_info:|main:)/

export function isWhisperLogLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || WHISPER_LOG_LINE.test(trimmed)
}

export function parseWhisperOutput(stdout: string): Utterance {
  const parts: string[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    const match = SEGMENT.exec(line)
    const segment = match?.[1]?.trim()
    if (segment) {
      parts.push(segment)
      continue
    }
    // Not a segment. Whisper's own log noise is discarded silently; anything
    // else is unexpected format drift and must not vanish without a trace,
    // given the verbatim requirement this module exists to satisfy.
    if (!isWhisperLogLine(line)) {
      console.warn(`parseWhisperOutput: unrecognised line, discarding: ${line}`)
    }
  }
  return { text: parts.join(' ') }
}

// ~150 words/min * 45min * ~6 bytes/word, plus a ~30-byte timestamp prefix
// per segment, lands in the low hundreds of KB — 32MB is a wide margin, not a guess.
const WHISPER_MAX_BUFFER = 32 * 1024 * 1024

/**
 * Local transcription via whisper.cpp. Local is the point: it keeps filler and
 * false starts that cloud dictation normalises away — and those are exactly what
 * `/mock` grades — and interview audio never leaves the machine.
 */
export function whisperTranscriber(opts: { binary: string; model: string }): Transcriber {
  return {
    async transcribe(wavPath: string): Promise<Utterance> {
      try {
        const { stdout } = await run(opts.binary, [
          '--model', opts.model,
          '--file', wavPath,
          '--language', 'en',
          '--no-prints',
        ], { maxBuffer: WHISPER_MAX_BUFFER })
        return parseWhisperOutput(stdout)
      } catch (err) {
        throw new Error(
          `whisper transcription failed (binary: ${opts.binary}, model: ${opts.model}, file: ${wavPath})`,
          { cause: err },
        )
      }
    },
  }
}

export interface SayOptions {
  voice?: string
  rate?: number
  audioDevice?: string
}

/**
 * Build the argv for macOS `say`. Pure so it can be tested without exercising
 * the `execFile` subprocess — asserting on `say`'s audio would be testing
 * third-party software, which is out of scope here.
 *
 * `-a <id>` selects the output device. It's a real, undocumented `say` flag
 * (absent from `say --help`) — not a typo for a documented one.
 */
export function sayArgs(text: string, opts: SayOptions = {}): string[] {
  const args: string[] = []
  if (opts.voice) args.push('-v', opts.voice)
  if (opts.rate) args.push('-r', String(opts.rate))
  if (opts.audioDevice) args.push('-a', opts.audioDevice)
  args.push(text)
  return args
}

/** macOS `say`. Robotic but free and instant; swap this out, not the loop. */
export function saySpeaker(opts: SayOptions = {}): Speaker {
  return {
    async speak(text: string): Promise<void> {
      try {
        await run('say', sayArgs(text, opts))
      } catch (err) {
        throw new Error(
          `macOS \`say\` failed to speak text (voice: ${opts.voice ?? 'default'}, length: ${text.length})`,
          { cause: err },
        )
      }
    },
  }
}
