import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface Recorder {
  /** Stop capture and resolve with the path to the finished wav. */
  stop(): Promise<string>
}

/** 16 kHz mono PCM — whisper's native input format, so no resampling step. */
export function ffmpegArgs(device: string, wavPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', device,
    '-ar', '16000',
    '-ac', '1',
    '-y',
    wavPath,
  ]
}

/**
 * Start capturing immediately and keep going until `stop()`. There is no
 * silence detection on purpose: in a design drill a long pause is the exercise,
 * not the end of a turn.
 */
export function record(dir: string, device = ':0'): Recorder {
  const wavPath = join(dir, `turn-${process.hrtime.bigint()}.wav`)
  const child = spawn('ffmpeg', ffmpegArgs(device, wavPath), { stdio: 'ignore' })

  return {
    stop(): Promise<string> {
      return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', () => resolve(wavPath))
        // SIGINT asks ffmpeg to finalise the container; SIGKILL would truncate it.
        child.kill('SIGINT')
      })
    },
  }
}
