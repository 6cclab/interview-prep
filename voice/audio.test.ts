import { describe, expect, it } from 'vitest'
import { ffmpegArgs } from './audio'

describe('ffmpegArgs', () => {
  it('captures from the given avfoundation device', () => {
    const args = ffmpegArgs(':0', '/tmp/turn.wav')
    expect(args).toContain('avfoundation')
    expect(args).toContain(':0')
  })

  it('records 16 kHz mono, which is what whisper expects', () => {
    const args = ffmpegArgs(':0', '/tmp/turn.wav')
    expect(args).toContain('16000')
    expect(args.join(' ')).toMatch(/-ac 1/)
  })

  it('writes to the requested path', () => {
    expect(ffmpegArgs(':0', '/tmp/turn.wav').at(-1)).toBe('/tmp/turn.wav')
  })
})
