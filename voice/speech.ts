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

export function parseWhisperOutput(stdout: string): Utterance {
  const parts: string[] = []
  for (const line of stdout.split('\n')) {
    const match = SEGMENT.exec(line.trim())
    const segment = match?.[1]?.trim()
    if (segment) parts.push(segment)
  }
  return { text: parts.join(' ') }
}

/**
 * Local transcription via whisper.cpp. Local is the point: it keeps filler and
 * false starts that cloud dictation normalises away — and those are exactly what
 * `/mock` grades — and interview audio never leaves the machine.
 */
export function whisperTranscriber(opts: { binary: string; model: string }): Transcriber {
  return {
    async transcribe(wavPath: string): Promise<Utterance> {
      const { stdout } = await run(opts.binary, [
        '--model', opts.model,
        '--file', wavPath,
        '--language', 'en',
        '--no-prints',
      ])
      return parseWhisperOutput(stdout)
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
      await run('say', args)
    },
  }
}
