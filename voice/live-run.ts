import type { Transcriber } from './speech'
import type { TranscribedSegment } from './live-artifact'
import type { SegmentedRecorder } from './live'
import { closedSegments } from './live'
import { join } from 'node:path'

/**
 * Turning a running capture into transcribed segments.
 *
 * Separate from `live.ts` (which owns ffmpeg and the safety gate) and from
 * `live-artifact.ts` (which owns the file) because this is the only part with a
 * clock in it, and a clock is the thing that has to be injected to be tested.
 * Everything here takes its recorder, transcriber and sleep as arguments.
 */

/** `seg-007.wav` → 7. Segment numbering starts at 0, as ffmpeg's does. */
export function segmentIndex(name: string): number {
  return Number(/\d+/.exec(name)![0])
}

/**
 * Where a segment began, in milliseconds from the start of the round.
 *
 * Derived from the index rather than from file mtimes: mtime is when ffmpeg
 * last *wrote* to the file, which for a closed segment is its end, and using it
 * would stamp every line one segment late.
 */
export function segmentOffsetMs(name: string, seconds: number): number {
  return segmentIndex(name) * seconds * 1000
}

export interface CaptureDeps {
  /** Scratch directory the recorder is writing segments into. */
  dir: string
  recorder: SegmentedRecorder
  transcriber: Transcriber
  /** Segment length, to turn an index into an offset. */
  seconds: number
  /** Resolves when the round is over — the CLI wires this to Enter. */
  until: Promise<void>
  /** Injected sleep. Tests pass one that resolves immediately. */
  sleep: (ms: number) => Promise<void>
  pollMs?: number
  transcriptionPrompt?: string
  /** Called as each segment lands, so the CLI can show progress. */
  onSegment?: (segment: TranscribedSegment) => void
}

/**
 * Transcribe segments as they close, then drain what is left after the stop.
 *
 * Transcribing during the round rather than in one pass at the end is the whole
 * reason for segmenting: a 45-minute round through whisper is slow enough that a
 * single pass leaves the artifact unready at the moment it is most useful —
 * immediately afterwards, while the round is still recallable.
 *
 * A segment that fails to transcribe is recorded as a failure *in place* rather
 * than dropped or thrown. Dropping it would silently shorten the record; throwing
 * would discard every segment already transcribed, which is the failure this
 * whole module exists to prevent. The gap stays visible and the rest survives.
 */
export async function captureSegments(deps: CaptureDeps): Promise<TranscribedSegment[]> {
  const pollMs = deps.pollMs ?? 5_000
  const done = new Set<string>()
  const segments: TranscribedSegment[] = []

  const take = async (name: string): Promise<void> => {
    if (done.has(name)) return
    done.add(name)
    const segment: TranscribedSegment = {
      offsetMs: segmentOffsetMs(name, deps.seconds),
      text: await transcribeOne(deps, name),
    }
    segments.push(segment)
    deps.onSegment?.(segment)
  }

  let running = true
  const stopped = deps.until.then(() => {
    running = false
  })

  while (running) {
    // The newest file is the one ffmpeg still has open; `closedSegments` with no
    // argument would include it, and a partial wav transcribes into a sentence
    // that stops mid-word and reads as if he did.
    const names = deps.recorder.written()
    for (const name of names.slice(0, -1)) await take(name)
    if (!running) break
    await Promise.race([deps.sleep(pollMs), stopped])
  }

  await stopped
  // `stop()` resolves only once ffmpeg has finalised the wav header on the last
  // segment, so everything on disk is complete by here — including the segment
  // that was open a moment ago, which is the end of the interview.
  await deps.recorder.stop()
  for (const name of closedSegments(deps.dir)) await take(name)

  // `take` pushes in completion order, which is arrival order today but need not
  // stay that way. Sorting by offset is what actually guarantees the transcript
  // reads in the order it was said.
  return segments.sort((a, b) => a.offsetMs - b.offsetMs)
}

async function transcribeOne(deps: CaptureDeps, name: string): Promise<string> {
  try {
    const { text } = await deps.transcriber.transcribe(
      join(deps.dir, name),
      deps.transcriptionPrompt,
    )
    return text
  } catch (error) {
    return `_(transcription failed for ${name}: ${(error as Error).message})_`
  }
}
