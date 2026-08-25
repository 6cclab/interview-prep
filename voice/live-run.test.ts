import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SegmentedRecorder } from './live'
import { captureSegments, segmentIndex, segmentOffsetMs } from './live-run'

describe('segment offsets', () => {
  it('reads the index out of the name', () => {
    expect(segmentIndex('seg-000.wav')).toBe(0)
    expect(segmentIndex('seg-007.wav')).toBe(7)
    expect(segmentIndex('seg-100.wav')).toBe(100)
  })

  /**
   * Derived from the index, not from mtime. mtime is when ffmpeg last wrote to
   * the file, which for a closed segment is its *end* — using it would stamp
   * every line one whole segment late.
   */
  it('turns an index into an offset from the start of the round', () => {
    expect(segmentOffsetMs('seg-000.wav', 300)).toBe(0)
    expect(segmentOffsetMs('seg-002.wav', 300)).toBe(600_000)
  })
})

/** A recorder over a real temp dir, so `closedSegments` reads something true. */
function fakeRecorder(dir: string, names: string[]): SegmentedRecorder & { add(name: string): void } {
  const written: string[] = []
  const add = (name: string): void => {
    writeFileSync(join(dir, name), 'RIFF')
    written.push(name)
  }
  for (const name of names) add(name)
  return { written: () => [...written], stop: async () => {}, add }
}

const immediately = async (): Promise<void> => {}

describe('captureSegments', () => {
  it('transcribes closed segments and stamps them in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav', 'seg-001.wav', 'seg-002.wav'])
    const transcriber = { transcribe: vi.fn(async (p: string) => ({ text: `text for ${p.split('/').pop()}` })) }

    const segments = await captureSegments({
      dir,
      recorder,
      transcriber,
      seconds: 300,
      until: Promise.resolve(),
      sleep: immediately,
    })

    expect(segments).toEqual([
      { offsetMs: 0, text: 'text for seg-000.wav' },
      { offsetMs: 300_000, text: 'text for seg-001.wav' },
      { offsetMs: 600_000, text: 'text for seg-002.wav' },
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * The final segment is the end of the interview — the part worth keeping —
   * and it is the one ffmpeg still had open. It only becomes transcribable
   * after `stop()` resolves, so the drain has to happen after the stop, not
   * before it.
   */
  it('picks up the segment that was still open when the round ended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav', 'seg-001.wav'])
    const transcriber = { transcribe: vi.fn(async () => ({ text: 'x' })) }

    const segments = await captureSegments({
      dir,
      recorder,
      transcriber,
      seconds: 300,
      until: Promise.resolve(),
      sleep: immediately,
    })

    expect(segments).toHaveLength(2)
    expect(transcriber.transcribe).toHaveBeenCalledTimes(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('never transcribes the same segment twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav', 'seg-001.wav', 'seg-002.wav'])
    const transcriber = { transcribe: vi.fn(async () => ({ text: 'x' })) }

    // Several polls before the stop, each seeing the same closed segments.
    let ticks = 0
    let release = (): void => {}
    const until = new Promise<void>((resolve) => {
      release = resolve
    })
    const sleep = async (): Promise<void> => {
      if (++ticks >= 3) release()
    }

    const segments = await captureSegments({ dir, recorder, transcriber, seconds: 300, until, sleep })

    expect(segments).toHaveLength(3)
    expect(transcriber.transcribe).toHaveBeenCalledTimes(3)
    rmSync(dir, { recursive: true, force: true })
  })

  it('transcribes segments as they close rather than only at the end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav', 'seg-001.wav'])
    const seen: string[] = []
    const transcriber = {
      transcribe: vi.fn(async (p: string) => {
        seen.push(p.split('/').pop()!)
        return { text: 'x' }
      }),
    }

    let release = (): void => {}
    const until = new Promise<void>((resolve) => {
      release = resolve
    })
    const sleep = async (): Promise<void> => {
      // By now the first poll has run: seg-000 is closed and should already be
      // transcribed, before the round has ended.
      expect(seen).toEqual(['seg-000.wav'])
      recorder.add('seg-002.wav')
      release()
    }

    await captureSegments({ dir, recorder, transcriber, seconds: 300, until, sleep })
    expect(seen).toEqual(['seg-000.wav', 'seg-001.wav', 'seg-002.wav'])
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A failed segment is recorded in place. Dropping it would silently shorten
   * the record; throwing would discard every segment already transcribed —
   * which is the loss this whole module exists to prevent.
   */
  it('keeps the rest when one segment fails to transcribe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav', 'seg-001.wav'])
    const transcriber = {
      transcribe: vi.fn(async (p: string) => {
        if (p.endsWith('seg-000.wav')) throw new Error('whisper-cli not found')
        return { text: 'the rest survived' }
      }),
    }

    const segments = await captureSegments({
      dir,
      recorder,
      transcriber,
      seconds: 300,
      until: Promise.resolve(),
      sleep: immediately,
    })

    expect(segments).toHaveLength(2)
    expect(segments[0]!.text).toContain('whisper-cli not found')
    expect(segments[1]!.text).toBe('the rest survived')
    rmSync(dir, { recursive: true, force: true })
  })

  it('stops the recorder even when nothing was captured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, [])
    const stop = vi.fn(async () => {})

    const segments = await captureSegments({
      dir,
      recorder: { ...recorder, stop },
      transcriber: { transcribe: vi.fn() },
      seconds: 300,
      until: Promise.resolve(),
      sleep: immediately,
    })

    expect(segments).toEqual([])
    expect(stop).toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes the vocabulary prompt through to the transcriber', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-run-'))
    const recorder = fakeRecorder(dir, ['seg-000.wav'])
    const transcriber = { transcribe: vi.fn(async () => ({ text: 'x' })) }

    await captureSegments({
      dir,
      recorder,
      transcriber,
      seconds: 300,
      until: Promise.resolve(),
      sleep: immediately,
      transcriptionPrompt: 'O(n log n), memoization',
    })

    expect(transcriber.transcribe).toHaveBeenCalledWith(
      join(dir, 'seg-000.wav'),
      'O(n log n), memoization',
    )
    rmSync(dir, { recursive: true, force: true })
  })
})
