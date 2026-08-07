import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
}
