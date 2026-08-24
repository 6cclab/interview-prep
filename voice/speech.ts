import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
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
  // `--` terminates option parsing, so a sentence beginning with a hyphen is
  // spoken rather than parsed as a flag. Without it `say` exits 1 and the
  // sentence is silently dropped: measured on 2026-08-12, a live drill lost two
  // consecutive replies because the interviewer emitted markdown bullets, which
  // its prompt forbids but a model still produces. The prompt is the first line
  // of defence and this is the second — model output reaching an argv array is
  // untrusted input whatever the prompt says.
  //
  // `piperSpeaker` needs no equivalent: it writes the text to piper's stdin.
  args.push('--', text)
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

export type SpeechEngine = 'say' | 'piper'

const ENGINES: readonly SpeechEngine[] = ['say', 'piper']

/**
 * Which TTS engine to use.
 *
 * Platform is the default; `SAY_ENGINE` is the override and wins in both
 * directions. An unrecognised value throws rather than falling back, matching
 * `chooseBackend`: silently running a 45-minute drill on something you did not
 * choose is the failure this repo refuses to have.
 */
export function resolveEngine(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): SpeechEngine {
  const raw = (env.SAY_ENGINE ?? '').trim().toLowerCase()
  if (raw === '') return platform === 'darwin' ? 'say' : 'piper'
  if ((ENGINES as readonly string[]).includes(raw)) return raw as SpeechEngine
  throw new Error(`SAY_ENGINE="${env.SAY_ENGINE}" is not a known engine. Use one of: ${ENGINES.join(', ')}.`)
}

/** piper's default sample rate for the medium voices. `ffplay` must be told; it cannot infer it from raw PCM. */
const PIPER_SAMPLE_RATE = 22050

/**
 * `rate` is words-per-minute for `say` and a length multiplier for piper, where
 * higher is *slower*. 175 wpm is roughly `say`'s default, so that maps to 1.0
 * and the scale moves inversely from there. Clamped, because a wild wpm should
 * cost the pace and not the drill — the same trade `resolveSpeech` makes when
 * it drops an unusable rate rather than passing it to `say -r`.
 */
export function lengthScaleFor(rate: number): number {
  const scale = 175 / rate
  return Math.min(1.4, Math.max(0.6, Number(scale.toFixed(2))))
}

/** Build piper's argv. Pure, so it is tested without spawning anything. */
export function piperArgs(opts: SayOptions = {}): string[] {
  const args = ['--output_raw']
  if (opts.voice) args.push('--model', opts.voice)
  if (opts.rate) args.push('--length_scale', String(lengthScaleFor(opts.rate)))
  return args
}

/** Build ffplay's argv for piper's raw output. `-` reads stdin. */
export function ffplayArgs(): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nodisp',
    '-autoexit',
    '-f', 's16le',
    '-ar', String(PIPER_SAMPLE_RATE),
    '-ac', '1',
    '-',
  ]
}

/**
 * A sentence being turned into audio, for a listener who is somewhere else.
 *
 * `Speaker` and `Synthesizer` are the same engine pointed at two different
 * places. A `Speaker` plays to the machine it runs on, which is right when
 * that machine is the one with the candidate in front of it. A `Synthesizer`
 * hands the bytes back instead, for the deployed case where the server is in
 * a datacentre and the only speakers that matter are the browser's.
 */
export interface Synthesis {
  /** WAV: a streaming header (see `wavHeader`) followed by piper's PCM. */
  audio: Readable
  /** Kills the synthesiser. Safe after it has already exited. */
  cancel(): void
}

export interface Synthesizer {
  synthesize(text: string): Synthesis
}

/**
 * A WAV header for audio whose length is not known yet.
 *
 * Synthesis is streamed as piper produces it — waiting for the whole sentence
 * before sending any of it would add the full synthesis time to the silence
 * before the first word, which is the one cost this approach has over
 * `SpeechSynthesis` and the one worth not paying twice.
 *
 * That means the two size fields cannot be filled in. `0xffffffff` is what
 * ffmpeg itself writes when muxing WAV to a pipe, and every browser decoder
 * reads it as "keep going until the stream ends".
 */
export function wavHeader(sampleRate: number = PIPER_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  const bitsPerSample = 16
  const channels = 1
  const byteRate = (sampleRate * channels * bitsPerSample) / 8

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(0xffffffff, 4) // RIFF chunk size — unknown
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // PCM fmt chunk is 16 bytes
  header.writeUInt16LE(1, 20) // 1 = uncompressed PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32) // block align
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(0xffffffff, 40) // data chunk size — unknown
  return header
}

/**
 * piper writing WAV to a stream instead of to a speaker.
 *
 * The subprocess is the same one `piperSpeaker` runs — `--output_raw` on
 * stdout — which is why this could be added at all: the only thing that was
 * ever local about server-side TTS was the `ffplay` on the other end of the
 * pipe.
 *
 * Errors arrive as an `error` event on `audio` rather than a rejected promise,
 * because the response has usually started by the time piper fails and there
 * is no longer a status code to change. The route's job at that point is to
 * destroy the response so the browser sees a truncated body and moves on,
 * which is exactly what one missed sentence should cost.
 */
export function piperSynthesizer(opts: SayOptions = {}): Synthesizer {
  return {
    synthesize(text: string): Synthesis {
      const piper = spawn('piper', piperArgs(opts), { stdio: ['pipe', 'pipe', 'pipe'] })
      // `PassThrough` rather than handing back `piper.stdout` directly: the
      // header has to go first, and prepending to a subprocess's own stdout is
      // not something a caller should have to remember to do.
      const audio = new PassThrough()
      audio.write(wavHeader())

      piper.on('error', (err) => {
        audio.destroy(new Error(`failed to spawn "piper": ${err.message}`))
      })
      piper.stdout?.pipe(audio)
      // piper is chatty on stderr even when it succeeds, so a non-zero exit is
      // the only signal worth acting on. A killed process is a cancellation —
      // the listener navigated away — and must not be reported as a failure.
      piper.on('close', (code, signal) => {
        if (signal === null && code !== 0 && code !== null) {
          audio.destroy(new Error(`piper exited with code ${String(code)}`))
        }
      })
      piper.stdin?.end(text)

      return {
        audio,
        cancel(): void {
          piper.kill()
          audio.destroy()
        },
      }
    },
  }
}

/**
 * Confirm piper can run, at startup, for a server that synthesises rather than
 * speaks. Deliberately does not require `ffplay`: nothing is being played
 * here, and demanding a player would make a deployed image carry a binary it
 * would never run.
 */
export function checkSynthEngine(voice?: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    execFileSync('command', ['-v', 'piper'], { env, shell: true, stdio: 'ignore' })
  } catch {
    throw new Error('piper is not on PATH')
  }
  // Checked here rather than left to piper, which reports a missing model on
  // stderr of a process whose stdout is already being streamed to a browser —
  // i.e. as a sentence that plays as silence.
  if (voice && !existsSync(voice)) {
    throw new Error(`PIPER_VOICE="${voice}" does not exist`)
  }
  return voice ? `piper, ${basename(voice)}, streamed to the browser` : 'piper (default voice), streamed to the browser'
}

/**
 * piper synthesising to stdout, piped into ffplay.
 *
 * Two processes rather than one because piper writes audio and does not play
 * it. ffplay is chosen as the player because ffmpeg is already a hard
 * dependency of the browser tracks (`voice/transcode.ts`), so this adds one
 * binary rather than two.
 *
 * `stop()` kills both ends. It is not optional here for the same reason
 * `saySpeaker` implements it: TTS runs on the server, so a page that closes has
 * no effect on a running subprocess, and without it a refresh mid-turn leaves
 * the interviewer reading its reply to an empty room.
 */
export function piperSpeaker(opts: SayOptions = {}): Speaker {
  let current: { piper: ReturnType<typeof spawn>; player: ReturnType<typeof spawn> } | null = null

  return {
    async speak(text: string): Promise<void> {
      const piper = spawn('piper', piperArgs(opts), { stdio: ['pipe', 'pipe', 'pipe'] })
      const player = spawn('ffplay', ffplayArgs(), { stdio: ['pipe', 'ignore', 'pipe'] })
      const call = { piper, player }
      current = call
      piper.stdout?.pipe(player.stdin!)
      piper.stdin?.end(text)

      try {
        await new Promise<void>((resolve, reject) => {
          let failed: Error | null = null
          piper.once('error', (err) => { failed = new Error(`failed to spawn "piper": ${err.message}`) })
          player.once('error', (err) => { failed = new Error(`failed to spawn "ffplay": ${err.message}`) })
          player.once('close', (code, signal) => {
            // A killed utterance is a cancellation, not a failure — `stop` was
            // called on purpose, and throwing here would log a TTS error for
            // every ordinary page refresh.
            if (signal !== null) resolve()
            else if (failed) reject(failed)
            else if (code === 0) resolve()
            else reject(new Error(`ffplay exited with code ${String(code)}`))
          })
        })
      } catch (err) {
        throw new Error(
          `piper failed to speak text (voice: ${opts.voice ?? 'default'}, length: ${text.length})`,
          { cause: err },
        )
      } finally {
        // Same guard `saySpeaker` applies: a finishing call must not clear a
        // newer, still-running call's handle out from under it, or `stop()`
        // loses the ability to reach the orphaned pair.
        if (current === call) current = null
      }
    },

    stop(): void {
      current?.piper.kill()
      current?.player.kill()
      current = null
    },
  }
}

/** The speaker for this machine. The one function every front end should call. */
export function resolveSpeaker(
  opts: SayOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): Speaker {
  return resolveEngine(env, platform) === 'say' ? saySpeaker(opts) : piperSpeaker(opts)
}

/**
 * Confirm the chosen engine can actually run, at startup.
 *
 * Without this, a missing binary surfaces when the interviewer first speaks —
 * minutes into a drill, after a model turn has already been spent. Returns a
 * banner line on success and throws on failure, so `main()` can print one and
 * refuse to start on the other.
 */
export function checkSpeechEngine(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string {
  const engine = resolveEngine(env, platform)
  const binaries = engine === 'say' ? ['say'] : ['piper', 'ffplay']
  for (const binary of binaries) {
    try {
      execFileSync('command', ['-v', binary], { env, shell: true, stdio: 'ignore' })
    } catch {
      throw new Error(
        `TTS engine "${engine}" needs "${binary}", which is not on PATH. ` +
          `Install it, or set SAY_ENGINE to one you have (say | piper).`,
      )
    }
  }
  return `Speech: ${engine} (${binaries.join(' + ')})`
}
