import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Utterance {
  text: string
}

export interface Transcriber {
  /**
   * @param wavPath 16 kHz mono PCM wav.
   * @param prompt Vocabulary hints for the decoder — see `voice/vocabulary.ts`.
   *   Optional so the stand-in transcribers in tests need not care, and so a
   *   caller with no track context can omit it rather than invent one.
   */
  transcribe(wavPath: string, prompt?: string): Promise<Utterance>
}

export interface Speaker {
  speak(text: string): Promise<void>
  /**
   * Cuts off whatever is being spoken right now.
   *
   * Needed because TTS happens *here*, on the server, not in the browser: a
   * page that reloads or closes has no effect on a running `say`. Without this,
   * refreshing mid-turn left the interviewer reading its reply aloud to an empty
   * room — and on the coding track, `beforeunload`'s `/end` beacon then started
   * a whole closing verdict that nobody was there to hear.
   *
   * Optional so a test stub need not implement it. A speaker with nothing to
   * stop implements it as a no-op.
   */
  stop?(): void
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
/**
 * whisper-cli's argv. Pure, so the flags can be asserted without spawning it.
 *
 * `--prompt` is whisper.cpp's initial-prompt hook: it biases the decoder toward a
 * vocabulary without rewriting output. Omitted entirely when there is no prompt,
 * rather than passed empty — an empty initial prompt is not the same input as no
 * initial prompt, and there is no reason to find out how this build treats it.
 */
export function whisperArgs(model: string, wavPath: string, prompt?: string): string[] {
  const args = ['--model', model, '--file', wavPath, '--language', 'en', '--no-prints']
  if (prompt !== undefined && prompt.trim() !== '') args.push('--prompt', prompt)
  return args
}

export function whisperTranscriber(opts: { binary: string; model: string }): Transcriber {
  return {
    async transcribe(wavPath: string, prompt?: string): Promise<Utterance> {
      try {
        const { stdout } = await run(opts.binary, whisperArgs(opts.model, wavPath, prompt), {
          maxBuffer: WHISPER_MAX_BUFFER,
        })
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
  // The utterance in flight, so `stop` has something to kill. At most one:
  // `streamTurn` awaits each sentence before starting the next, precisely so
  // two `say` processes never overlap into gibberish.
  let current: ReturnType<typeof execFile> | null = null

  return {
    async speak(text: string): Promise<void> {
      // `execFile` rather than the promisified `run` used elsewhere in this
      // file: the child handle is the whole point here, and the promisified
      // form does not hand it back.
      const child = execFile('say', sayArgs(text, opts))
      current = child
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', (code, signal) => {
            // A killed utterance is a cancellation, not a failure — `stop` was
            // called on purpose, and throwing here would log a TTS error for
            // every ordinary page refresh.
            if (signal !== null) resolve()
            else if (code === 0) resolve()
            else reject(new Error(`say exited with code ${String(code)}`))
          })
        })
      } catch (err) {
        throw new Error(
          `macOS \`say\` failed to speak text (voice: ${opts.voice ?? 'default'}, length: ${text.length})`,
          { cause: err },
        )
      } finally {
        if (current === child) current = null
      }
    },
    stop(): void {
      current?.kill()
      current = null
    },
  }
}
