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
// `whisper_model_load: n_vocab = 51866`, `system_info: n_threads = 4`.
// A lowercase/underscore identifier (optionally parenthesised) followed by a
// colon is enough to recognise them; an empty line is also noise.
const WHISPER_LOG_LINE = /^[a-z_]+(\s*\([^)]*\))?:/

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

// A long interview answer's whisper.cpp stdout/stderr is unlikely to reach
// Node's 1MB default `maxBuffer`, but exceeding it fails with an opaque
// ERR_CHILD_PROCESS_STDIO_MAXBUFFER — raise the ceiling well clear of that.
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

/** macOS `say`. Robotic but free and instant; swap this out, not the loop. */
export function saySpeaker(opts: { voice?: string; rate?: number } = {}): Speaker {
  return {
    async speak(text: string): Promise<void> {
      const args: string[] = []
      if (opts.voice) args.push('-v', opts.voice)
      if (opts.rate) args.push('-r', String(opts.rate))
      args.push(text)
      try {
        await run('say', args)
      } catch (err) {
        throw new Error('macOS `say` failed to speak text', { cause: err })
      }
    },
  }
}
