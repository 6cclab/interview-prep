import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ffmpegArgs, record } from './audio'

// Fixed sleeps to let a forked stand-in finish writing its wav are flaky
// under a loaded machine (many test files' subprocesses competing for
// scheduling) — poll the directory instead of guessing a delay. record()
// itself picks the wav's name, so watch for anything matching its pattern.
async function waitForWavFile(dir: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!readdirSync(dir).some((name) => /^turn-.*\.wav$/.test(name))) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for a wav file in ${dir}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

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

  // `record()` now checks that a clean exit actually left a wav behind, so
  // stand-ins exercising a "clean" outcome have to write to their last argv
  // (the wav path — see `ffmpegArgs`'s "writes to the requested path" test
  // above) instead of being pure no-ops like bare `true`/`yes`. Stand-ins for
  // failure paths (`false`, a nonexistent binary) are untouched: those still
  // reject before the new check ever runs.
  function fakeFfmpeg(body: string): string {
    const scriptPath = join(dir, `fake-ffmpeg-${Math.random().toString(36).slice(2)}.sh`)
    writeFileSync(scriptPath, `#!/bin/bash\n${body}\n`)
    chmodSync(scriptPath, 0o755)
    return scriptPath
  }

  it('settles stop() when the child already exited cleanly before stop was called', async () => {
    const recorder = record(dir, ':0', fakeFfmpeg('echo "fake wav bytes" > "${@: -1}"'))
    // give the child time to exit on its own, well before stop() is called
    await waitForWavFile(dir)
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
    const recorder = record(dir, ':0', fakeFfmpeg('echo "fake wav bytes" > "${@: -1}"'))
    // give the child time to write before either stop() call races its exit
    await waitForWavFile(dir)
    const first = recorder.stop()
    const second = recorder.stop()
    await expect(first).resolves.toMatch(/turn-.*\.wav$/)
    await expect(second).resolves.toMatch(/turn-.*\.wav$/)
  }, 5000)

  it('sends SIGINT to a running child and resolves with the wav path', async () => {
    const recorder = record(dir, ':0', fakeFfmpeg('echo "fake wav bytes" > "${@: -1}"\nexec sleep 100000'))
    // let the child actually write its file (then keep running via `exec
    // sleep`) before we interrupt it
    await waitForWavFile(dir)
    await expect(recorder.stop()).resolves.toMatch(/turn-.*\.wav$/)
  }, 5000)

  it('rejects when the child exits cleanly but never wrote the wav', async () => {
    const recorder = record(dir, ':0', 'true')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(recorder.stop()).rejects.toThrow(/never written/)
  }, 5000)
})
