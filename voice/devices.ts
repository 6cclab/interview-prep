import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Device {
  id: string
  name: string
}

const AUDIO_HEADER = /AVFoundation audio devices:/
const VIDEO_HEADER = /AVFoundation video devices:/
const DEVICE_LINE = /\[(\d+)\]\s+(.*)$/

/**
 * Parse `ffmpeg -f avfoundation -list_devices true -i ""`, which writes to
 * stderr and lists video devices before audio ones. Indices restart per
 * section and names can repeat across them, so the section must be tracked —
 * grepping for `[N] Name` alone would offer cameras as microphones.
 */
export function parseInputDevices(stderr: string): Device[] {
  const devices: Device[] = []
  let inAudio = false
  for (const line of stderr.split('\n')) {
    if (VIDEO_HEADER.test(line)) {
      inAudio = false
      continue
    }
    if (AUDIO_HEADER.test(line)) {
      inAudio = true
      continue
    }
    if (!inAudio) continue
    const match = DEVICE_LINE.exec(line)
    if (match) devices.push({ id: `:${match[1]}`, name: match[2]!.trim() })
  }
  return devices
}

/** Parse `say -a '?'` — right-aligned numeric id, then the device name. */
export function parseOutputDevices(stdout: string): Device[] {
  const devices: Device[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match) devices.push({ id: match[1]!, name: match[2]!.trim() })
  }
  return devices
}

export async function listInputDevices(): Promise<Device[]> {
  // This invocation always exits non-zero — it lists devices, then fails to
  // open the empty input. The device list is on stderr either way.
  try {
    const { stderr } = await run('ffmpeg', [
      '-hide_banner',
      '-f', 'avfoundation',
      '-list_devices', 'true',
      '-i', '',
    ])
    return parseInputDevices(stderr)
  } catch (error) {
    return parseInputDevices(String((error as { stderr?: string }).stderr ?? ''))
  }
}

export async function listOutputDevices(): Promise<Device[]> {
  const { stdout } = await run('say', ['-a', '?'])
  return parseOutputDevices(stdout)
}

export interface Voice {
  name: string
  locale: string
  /**
   * `enhanced`, `premium` or `legacy`, from the parenthesised suffix `say`
   * prints. The tier is the point of listing these at all: it is the difference
   * between a neural voice and a 2009 concatenative one, and it is the only
   * thing here that predicts whether a drill sounds like a person.
   */
  tier: 'premium' | 'enhanced' | 'legacy'
}

/**
 * Parse `say -v '?'` — `Name  locale  # sample sentence`, where the name may
 * itself contain spaces and a parenthesised qualifier, e.g.
 * `Ava (Premium)          en_US    # Hello!`.
 *
 * Split on the locale rather than on whitespace: `Eddy (English (UK))` and
 * `Ava (Premium)` both contain spaces and brackets, so any name-side tokenising
 * gets one of them wrong.
 */
export function parseVoices(stdout: string): Voice[] {
  const voices: Voice[] = []
  for (const line of stdout.split('\n')) {
    const match = /^(.*?)\s+([a-z]{2}(?:[-_][A-Za-z]+)+)\s+#/.exec(line)
    if (!match) continue
    const name = match[1]!.trim()
    const tier = /\(premium\)/i.test(name) ? 'premium' : /\(enhanced\)/i.test(name) ? 'enhanced' : 'legacy'
    voices.push({ name, locale: match[2]!, tier })
  }
  return voices
}

export async function listVoices(): Promise<Voice[]> {
  const { stdout } = await run('say', ['-v', '?'])
  return parseVoices(stdout)
}

export interface DeviceConfig {
  /** `cli.ts`'s microphone selection — an avfoundation `ffmpeg` index (e.g. `:3`). */
  input?: string
  /**
   * The speaker/output device, shared by both front ends: `cli.ts`'s
   * `saySpeaker` and the web client's server-side TTS (`http-server.ts`)
   * both pass this straight through as `say -a <id>`, so it's the same id
   * space either way.
   */
  output?: string
  /**
   * The browser's own microphone selection — a `MediaDeviceInfo.deviceId`,
   * a different id space from `input` above (that one is an `ffmpeg`
   * avfoundation index; this one is whatever the browser assigns). Kept as
   * a distinct field rather than overloading `input` so a value written by
   * one front end is never fed to the other's device API by mistake.
   */
  webInput?: string
  /**
   * The `say` voice, by name as `say -v '?'` prints it (e.g. `Ava (Premium)`).
   *
   * Not a device, despite living in `DeviceConfig` — the file is
   * `local/voice.json` and has always been about how a drill sounds, of which
   * the output device is one part. Kept here rather than in a second config
   * file so there is one place to look and one merge to reason about.
   *
   * Unset means whatever the macOS system voice is, which on a machine with no
   * Enhanced or Premium voice downloaded is a 2009-era concatenative voice. The
   * voice is the dominant term in how human this sounds; see
   * ".claude/CLAUDE.md" > "How human the interviewer sounds".
   */
  voice?: string
  /**
   * Words per minute for `say -r`. Unset means the voice's own default, which
   * is around 175–200 depending on the voice.
   *
   * Worth setting a little low: an interviewer that talks at the speed of a
   * screen reader reads as a machine however good the voice is, and the pauses
   * are where you get to think.
   */
  rate?: number
}

/**
 * Read `local/voice.json`. Device ids are machine-specific and shift when a
 * headset is plugged in, so they live in gitignored local config rather than a
 * committed default. Any problem reading it yields an empty config — a bad
 * config file must not stop a drill from starting.
 */
export function readDeviceConfig(root: string): DeviceConfig {
  const path = join(root, 'local/voice.json')
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { input, output, webInput, voice, rate } = parsed as Record<string, unknown>
    const config: DeviceConfig = {}
    if (typeof input === 'string') config.input = input
    if (typeof output === 'string') config.output = output
    if (typeof webInput === 'string') config.webInput = webInput
    if (typeof voice === 'string' && voice.trim() !== '') config.voice = voice
    // Validated rather than passed through: `say -r` takes a number, and a
    // string or a NaN there fails the whole utterance. A bad rate must cost the
    // rate, not the drill — so it is dropped and the voice's default is used.
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) config.rate = rate
    return config
  } catch {
    return {}
  }
}

/** What to hand `saySpeaker` for voice and pace, once config and env are reconciled. */
export interface SpeechChoice {
  voice?: string
  rate?: number
}

/**
 * Reconcile the voice and rate: environment first, then `local/voice.json`, then
 * neither (the voice's own default).
 *
 * One function rather than the same two `??` chains in `cli.ts` and
 * `http-server.ts`, so `SAY_VOICE` cannot come to mean one thing in a terminal
 * drill and another in a browser drill. An unparseable `SAY_RATE` is ignored in
 * favour of the file rather than poisoning the utterance — same reasoning as the
 * `rate` validation in `readDeviceConfig`.
 */
export function resolveSpeech(config: DeviceConfig, env: NodeJS.ProcessEnv = process.env): SpeechChoice {
  const choice: SpeechChoice = {}
  const voice = env.SAY_VOICE ?? config.voice
  if (voice !== undefined && voice.trim() !== '') choice.voice = voice

  const fromEnv = env.SAY_RATE === undefined ? undefined : Number(env.SAY_RATE)
  const rate = fromEnv !== undefined && Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : config.rate
  if (rate !== undefined) choice.rate = rate
  return choice
}

/**
 * Persist `local/voice.json`, merged with whatever's already there — a
 * caller updating one field (e.g. the web client saving its speaker choice)
 * must not clobber a field it doesn't know about (e.g. `cli.ts`'s `input`).
 * `local/` is gitignored and gets created if this is the first write.
 */
export function writeDeviceConfig(root: string, patch: DeviceConfig): DeviceConfig {
  const current = readDeviceConfig(root)
  const next: DeviceConfig = { ...current, ...patch }
  mkdirSync(join(root, 'local'), { recursive: true })
  writeFileSync(join(root, 'local/voice.json'), JSON.stringify(next, null, 2))
  return next
}
