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

const STDERR_TAIL_BYTES = 8 * 1024

type Outcome =
  | { kind: 'clean' }
  | { kind: 'failed', reason: string }

/**
 * Start capturing immediately and keep going until `stop()`. There is no
 * silence detection on purpose: in a design drill a long pause is the exercise,
 * not the end of a turn.
 */
export function record(dir: string, device = ':0', binary = 'ffmpeg'): Recorder {
  const wavPath = join(dir, `turn-${process.hrtime.bigint()}.wav`)
  const child = spawn(binary, ffmpegArgs(device, wavPath), { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
  })

  // Attached immediately (not inside stop()) so a crash-on-launch or a bad
  // device exiting before stop() is ever called is still observed: an
  // unattached 'error' on a ChildProcess gets rethrown and can crash the
  // process, and 'close' fires exactly once, so a listener registered late
  // would simply miss it and stop() would hang forever.
  let outcome: Outcome | undefined
  let settle: (() => void) | undefined

  child.once('error', (err) => {
    if (outcome) return
    outcome = { kind: 'failed', reason: `failed to spawn "${binary}": ${err.message}` }
    settle?.()
  })

  child.once('close', (code, signal) => {
    if (outcome) return
    // ffmpeg interrupted by SIGINT (the normal way stop() ends a recording)
    // does not exit 0 — Node reports it as code === null, signal === 'SIGINT'.
    // Anything else is a truncated or missing file, the worst outcome here.
    if (code === 0 || signal === 'SIGINT') {
      outcome = { kind: 'clean' }
    } else {
      const tail = stderrTail.trim()
      outcome = {
        kind: 'failed',
        reason: `ffmpeg exited with code ${code} (signal ${signal})${tail ? `: ${tail}` : ''}`,
      }
    }
    settle?.()
  })

  const onParentExit = () => {
    if (child.pid !== undefined) child.kill()
  }
  process.once('exit', onParentExit)

  let stopped: Promise<string> | undefined

  return {
    stop(): Promise<string> {
      if (stopped) return stopped

      stopped = new Promise((resolve, reject) => {
        const finish = () => {
          process.removeListener('exit', onParentExit)
          if (!outcome) return
          if (outcome.kind === 'clean') resolve(wavPath)
          else reject(new Error(outcome.reason))
        }

        if (outcome) {
          finish()
          return
        }

        settle = finish
        // A child whose spawn is failing (e.g. ENOENT) never gets a pid.
        // Sending it a signal in that window crashes the process outright
        // instead of no-op'ing, so only signal a child that actually started;
        // the pending 'error' listener above settles this stop() either way.
        if (child.pid !== undefined) {
          // SIGINT asks ffmpeg to finalise the container; SIGKILL would truncate it.
          child.kill('SIGINT')
        }
      })

      return stopped
    },
  }
}
