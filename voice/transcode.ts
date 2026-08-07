import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'

// `promisify(execFile)` keeps Node's default 1MB maxBuffer rather than the
// bounded tail `audio.ts` uses. That default attaches the full stdout/stderr
// to a rejection (verified: execFile does set `.stderr` on the error), and
// `-loglevel error` keeps ffmpeg's output tiny for this one-shot call, so a
// truncated tail isn't needed here — considered and left as-is.
const run = promisify(execFile)

/**
 * whisper.cpp's native input format is 16kHz mono PCM wav. `ffmpeg` auto-
 * detects the input container from its bytes, so no `-f` is passed on the
 * input side — only the output shape is forced.
 */
export function ffmpegTranscodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-y',
    outputPath,
  ]
}

/**
 * Converts an uploaded browser recording (commonly webm/opus, but whatever
 * container `MediaRecorder` produced) to the wav shape `whisperTranscriber`
 * expects. Deliberately not tested beyond the argv it builds — asserting on
 * ffmpeg's actual transcode fidelity would be testing third-party software,
 * same standing exception the repo already makes for `say` and whisper.cpp
 * themselves.
 */
export async function transcodeToWav(inputPath: string, outputPath: string, binary = 'ffmpeg'): Promise<void> {
  try {
    await run(binary, ffmpegTranscodeArgs(inputPath, outputPath))
  } catch (err) {
    throw new Error(`ffmpeg transcode failed (input: ${inputPath})`, { cause: err })
  }

  // A zero exit does not guarantee a wav landed on disk (e.g. the binary was
  // a no-op stand-in, or ffmpeg silently declined to write). whisperTranscriber
  // gets handed this path next, so catch a missing/empty output here rather
  // than have it surface as an opaque whisper failure.
  let size: number
  try {
    size = (await stat(outputPath)).size
  } catch (err) {
    throw new Error(
      `ffmpeg exited cleanly but produced no output file (expected: ${outputPath})`,
      { cause: err },
    )
  }
  if (size === 0) {
    throw new Error(`ffmpeg exited cleanly but wrote an empty output file (expected: ${outputPath})`)
  }
}
