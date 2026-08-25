import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Device } from './devices'

/**
 * `/live` — a primary record of a real interview, made at minute zero.
 *
 * Every finding about how a round went is otherwise reconstructed from memory
 * a day later, and the drill log holds two records of that going wrong, both
 * *understating* him: a solve logged as `no` that passed 307/307 against a
 * brute-force oracle, and a session ended not knowing the code was correct.
 *
 * **This captures one microphone: his.** That is not a scope note, it is the
 * constraint the module is shaped around. Recording your own speech is not
 * interception — you are a party to the conversation. Recording the other side
 * is wiretap law, and the counterparties are routinely in all-party-consent
 * states. Two mechanisms make "own mic only" true in fact rather than in
 * intent, and both live here: `assertCapturable` refuses a loopback device
 * outright, and the caller must confirm headphones before capture starts.
 *
 * Neither is security — nothing here defends against someone determined to
 * record a call. They exist so the tool cannot *quietly* become the thing it
 * must not be, which is a different and achievable goal.
 */

/**
 * Devices that exist to capture system audio — i.e. the other party.
 *
 * Matched by name because that is all `avfoundation` gives us: the enumeration
 * is `[N] Name` and nothing more (see `parseInputDevices`). There is no device
 * class, no vendor id, no flag saying "this one is a virtual loopback".
 *
 * Names are drawn from the tools that actually exist on macOS rather than
 * guessed: BlackHole, Rogue Amoeba's Loopback, the older Soundflower, and the
 * two Audio MIDI Setup constructs — Aggregate and Multi-Output — which are how
 * you build a loopback without installing anything. `iShowU`, `Vb-Cable` and
 * `Sound Siphon` round out the ones in common use.
 *
 * **This list is allowed to be incomplete, and that is survivable; it is not
 * allowed to be wrong in the other direction.** A missed loopback is a device
 * the headphone rule still has to catch. A false positive on a real microphone
 * makes the tool refuse to record a legitimate interview, which is the failure
 * that gets the check disabled — so `Microphone`, `AirPods`, `Yeti` and every
 * ordinary interface must pass, and the tests assert exactly that.
 */
const LOOPBACK = [
  'blackhole',
  'loopback',
  'soundflower',
  'aggregate',
  'multi-output',
  'ishowu',
  'vb-cable',
  'vb cable',
  'sound siphon',
  'virtual audio',
]

/** Is this input device one that can hear the other party? */
export function isLoopbackDevice(name: string): boolean {
  const lowered = name.toLowerCase()
  return LOOPBACK.some((needle) => lowered.includes(needle))
}

/** Thrown when capture must not start. Distinct so the CLI can print it plainly. */
export class LiveRefused extends Error {}

/**
 * The gate, as a function that throws rather than a boolean that can be ignored.
 *
 * A `canCapture(): boolean` would put the decision at every call site and make
 * "warn and continue" a one-word change. The plan is explicit that warn-and-
 * continue is not an option here, so the shape enforces it: there is no value
 * to discard.
 *
 * `headphonesConfirmed` is the caller's assertion, not something this can
 * check — no API reports whether sound is leaving a speaker. It is a parameter
 * so that the confirmation is a visible argument at the call site rather than
 * a prompt buried somewhere in the CLI, and so the tests can state both halves.
 */
export function assertCapturable(device: Device, headphonesConfirmed: boolean): void {
  if (isLoopbackDevice(device.name)) {
    throw new LiveRefused(
      `"${device.name}" is a loopback or aggregate device, which captures system audio — ` +
        `that is the other side of the call, and recording it is not something this tool will do. ` +
        `Choose your actual microphone with --device, or run \`pnpm voice:devices\` to list them.`,
    )
  }
  if (!headphonesConfirmed) {
    throw new LiveRefused(
      `Headphones are required. On speakers the microphone picks the interviewer up through the ` +
        `room, and "own microphone only" stops being true. Re-run with --headphones once they are on.`,
    )
  }
}

/**
 * ffmpeg arguments for a segmented capture.
 *
 * `record()` in `voice/audio.ts` spawns one ffmpeg for a whole session and
 * produces one wav. For a 45-minute round that is ~115MB, which is fine, and a
 * crash at minute 50 loses all of it — the exact failure this tool exists to
 * prevent. Each closed segment here is a complete wav on disk, so a crash costs
 * at most the open one.
 *
 * `-reset_timestamps 1` is load-bearing: without it every segment after the
 * first carries its offset from the start of the session, and whisper reads
 * that as a file that begins forty minutes in. The transcript comes back
 * timestamped into empty space.
 *
 * 16 kHz mono matches `ffmpegArgs`, and for the same reason — it is whisper's
 * native input, so nothing resamples.
 */
export function ffmpegSegmentArgs(device: string, dir: string, seconds = 300): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', device,
    '-ar', '16000',
    '-ac', '1',
    '-f', 'segment',
    '-segment_time', String(seconds),
    '-reset_timestamps', '1',
    '-y',
    join(dir, 'seg-%03d.wav'),
  ]
}

/**
 * Segment files in the order they were recorded.
 *
 * Numeric, not lexicographic. `readdirSync` returns `seg-010.wav` before
 * `seg-002.wav`, and a transcript assembled in that order is a conversation
 * with its middle moved to the front — which reads as a plausible transcript
 * of a different interview rather than as an error. The plan calls this the
 * obvious bug, so it gets its own function and its own test.
 *
 * Zero-padding to three digits makes the two orders agree up to segment 999,
 * which is 83 hours at the default segment length. Sorting numerically anyway
 * costs nothing and does not depend on the padding staying right.
 */
export function orderSegments(names: string[]): string[] {
  return names
    .filter((name) => /^seg-\d+\.wav$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
}

/** Closed segments in `dir`, in order. The open one is excluded — see `isClosed`. */
export function closedSegments(dir: string, openName?: string): string[] {
  return orderSegments(readdirSync(dir)).filter((name) => name !== openName)
}

/**
 * `local/live/<company>-<stamp>.md`.
 *
 * Not a `Track`, deliberately. `Track` drives `allowedPaths()` and the spoiler
 * gate — machinery that exists to stop an agent reading `solutions/` during a
 * drill. A real interview has no spoilable answer and no agent to fence, so
 * adding `'live'` there would buy nothing and touch the gate. `writeSession`
 * takes a relative path, which is all this needs.
 *
 * The stamp is minute-resolution and local-time: two rounds in one day are
 * common, two in one minute are not, and a file named for the hour you sat the
 * interview is easier to find than one named for UTC.
 */
export function livePath(company: string, startedAt: Date): string {
  const slug =
    company
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'interview'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${startedAt.getFullYear()}-${p(startedAt.getMonth() + 1)}-${p(startedAt.getDate())}` +
    `-${p(startedAt.getHours())}${p(startedAt.getMinutes())}`
  return `local/live/${slug}-${stamp}.md`
}

export interface SegmentedRecorder {
  /** Stop capture. Resolves once ffmpeg has closed the final segment. */
  stop(): Promise<void>
  /** Segment files written so far, in order. Safe to call while recording. */
  written(): string[]
}

/**
 * Start a segmented capture and keep going until `stop()`.
 *
 * No silence detection, matching `record()` and for a related reason: in a real
 * interview a long pause is data — the plan asks the summary to report where he
 * stalled — so silence must reach the transcript rather than end the capture.
 *
 * `stop()` sends `SIGINT` rather than `SIGKILL`. ffmpeg finalises the open
 * segment's wav header on SIGINT; killed outright it leaves a file whose header
 * claims a length it does not have, and whisper reads that as a truncated or
 * empty recording. The last five minutes are exactly the part worth keeping.
 */
export function recordSegmented(
  dir: string,
  device = ':0',
  binary = 'ffmpeg',
  seconds = 300,
  spawnFn: typeof spawn = spawn,
): SegmentedRecorder {
  const child = spawnFn(binary, ffmpegSegmentArgs(device, dir, seconds), {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192)
  })

  // Attached immediately rather than inside `stop()`: an unattached 'error' on
  // a ChildProcess is rethrown and can take the process down, and 'close' fires
  // exactly once, so a listener registered later would miss it and `stop()`
  // would never resolve. Same reasoning as `record()`.
  let closed = false
  let onClose: (() => void) | undefined
  const settle = (): void => {
    closed = true
    onClose?.()
  }
  child.once('error', settle)
  child.once('close', settle)

  return {
    written: () => {
      try {
        return orderSegments(readdirSync(dir))
      } catch {
        return []
      }
    },
    stop: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve()
        onClose = () => resolve()
        child.kill('SIGINT')
      }),
  }
}

/**
 * Whether a segment is finished being written.
 *
 * ffmpeg has the next segment open while the previous ones are complete, so
 * "every file but the newest" is the rule — but only once a second file
 * exists. Size is not a reliable signal on its own: a segment that has just
 * rolled over is briefly zero bytes, and a long silence produces a small but
 * complete file.
 *
 * Used to transcribe as segments close rather than in one pass at the end. A
 * 45-minute round through whisper is slow enough that a single pass leaves the
 * artifact unready at the moment it is most useful.
 */
export function isClosed(names: string[], name: string): boolean {
  const ordered = orderSegments(names)
  return ordered.indexOf(name) !== -1 && ordered.indexOf(name) < ordered.length - 1
}

/** A finished capture, before transcription. */
export interface LiveSession {
  company: string
  /** `live` or `debrief` — same artifact shape, different provenance. */
  mode: 'live' | 'debrief'
  startedAt: Date
  device: string
  segments: string[]
}

/** Total bytes on disk, for the CLI to report what a crash would have cost. */
export function capturedBytes(dir: string, names: string[]): number {
  return names.reduce((total, name) => {
    try {
      return total + statSync(join(dir, name)).size
    } catch {
      return total
    }
  }, 0)
}
