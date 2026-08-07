import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ffmpegArgs, record } from './audio'

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

describe('record', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audio-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('settles stop() when the child already exited cleanly before stop was called', async () => {
    const recorder = record(dir, ':0', 'true')
    // give the child time to exit on its own, well before stop() is called
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(recorder.stop()).resolves.toMatch(/turn-.*\.wav$/)
  }, 5000)

  it('rejects when the child already exited non-zero before stop was called', async () => {
    const recorder = record(dir, ':0', 'false')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(recorder.stop()).rejects.toThrow(/1/)
  }, 5000)

  it('rejects rather than hanging when the binary cannot be spawned', async () => {
    const recorder = record(dir, ':0', '/nonexistent/ffmpeg-does-not-exist')
    await expect(recorder.stop()).rejects.toThrow(/spawn|enoent/i)
  }, 5000)

  it('settles a second stop() call the same way as the first', async () => {
    const recorder = record(dir, ':0', 'true')
    const first = recorder.stop()
    const second = recorder.stop()
    await expect(first).resolves.toMatch(/turn-.*\.wav$/)
    await expect(second).resolves.toMatch(/turn-.*\.wav$/)
  }, 5000)

  it('sends SIGINT to a running child and resolves with the wav path', async () => {
    const recorder = record(dir, ':0', 'yes')
    // let the child actually be running before we interrupt it
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(recorder.stop()).resolves.toMatch(/turn-.*\.wav$/)
  }, 5000)
})
