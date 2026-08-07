import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ffmpegTranscodeArgs, transcodeToWav } from './transcode'

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

// A disposable stand-in binary, same technique `audio.ts`'s tests use for its
// subprocess wrapper: never assert on ffmpeg's actual transcode output, only
// on how `transcodeToWav` reacts to the exit code / file it's left behind.
function fakeFfmpeg(dir: string, body: string): string {
  const scriptPath = join(dir, 'fake-ffmpeg.sh')
  writeFileSync(scriptPath, `#!/bin/bash\n${body}\n`)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

describe('transcodeToWav', () => {
  let dir: string
  let inputPath: string
  let outputPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'transcode-test-'))
    inputPath = join(dir, 'turn.webm')
    outputPath = join(dir, 'turn.wav')
    writeFileSync(inputPath, 'not really webm, never read by the stand-ins below')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves when ffmpeg exits cleanly and leaves a non-empty output file', async () => {
    const binary = fakeFfmpeg(dir, 'echo "fake wav bytes" > "${@: -1}"')
    await expect(transcodeToWav(inputPath, outputPath, binary)).resolves.toBeUndefined()
  })

  it('rejects when ffmpeg exits non-zero, with the underlying error as cause', async () => {
    await expect(transcodeToWav(inputPath, outputPath, 'false')).rejects.toThrow(/ffmpeg transcode failed/)
    try {
      await transcodeToWav(inputPath, outputPath, 'false')
      expect.unreachable('expected transcodeToWav to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).cause).toBeDefined()
    }
  })

  it('rejects rather than hanging when the binary cannot be spawned', async () => {
    await expect(
      transcodeToWav(inputPath, outputPath, '/nonexistent/ffmpeg-does-not-exist'),
    ).rejects.toThrow(/ffmpeg transcode failed/)
  })

  it('rejects when ffmpeg exits cleanly but produces no output file', async () => {
    await expect(transcodeToWav(inputPath, outputPath, 'true')).rejects.toThrow(/no output file/)
  })

  it('rejects when ffmpeg exits cleanly but writes an empty output file', async () => {
    const binary = fakeFfmpeg(dir, 'touch "${@: -1}"')
    await expect(transcodeToWav(inputPath, outputPath, binary)).rejects.toThrow(/empty output file/)
  })
})
