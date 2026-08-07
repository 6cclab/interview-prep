import { describe, expect, it } from 'vitest'
import { ffmpegTranscodeArgs } from './transcode'

describe('ffmpegTranscodeArgs', () => {
  it('resamples to 16kHz mono and overwrites the output', () => {
    expect(ffmpegTranscodeArgs('/tmp/turn.webm', '/tmp/turn.wav')).toEqual([
      '-hide_banner',
      '-loglevel', 'error',
      '-i', '/tmp/turn.webm',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      '/tmp/turn.wav',
    ])
  })

  it('does not force an input container — ffmpeg auto-detects webm/opus from the bytes', () => {
    const args = ffmpegTranscodeArgs('/tmp/turn.webm', '/tmp/turn.wav')
    expect(args).not.toContain('-f')
  })
})
