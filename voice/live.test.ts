import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertCapturable,
  capturedBytes,
  closedSegments,
  ffmpegSegmentArgs,
  isClosed,
  isLoopbackDevice,
  LiveRefused,
  livePath,
  orderSegments,
  recordSegmented,
} from './live'

/**
 * The loopback block is the load-bearing safety property of this module, so it
 * is tested first and tested hardest — the plan says so and it is right: every
 * other test here protects a convenience, this one protects the claim that the
 * tool records one side of a conversation.
 */
describe('isLoopbackDevice', () => {
  // The tools that actually exist on macOS for capturing system audio, plus the
  // two Audio MIDI Setup constructs that do it without installing anything.
  it.each([
    'BlackHole 2ch',
    'BlackHole 16ch',
    'Loopback Audio',
    'Soundflower (2ch)',
    'Aggregate Device',
    'Multi-Output Device',
    'iShowU Audio Capture',
    'VB-Cable',
    'Sound Siphon',
    'Virtual Audio Device',
  ])('refuses %s', (name) => {
    expect(isLoopbackDevice(name)).toBe(true)
  })

  it('matches regardless of case', () => {
    expect(isLoopbackDevice('blackhole 2ch')).toBe(true)
    expect(isLoopbackDevice('BLACKHOLE 2CH')).toBe(true)
    expect(isLoopbackDevice('AGGREGATE DEVICE')).toBe(true)
  })

  /**
   * The other direction, which matters more than it looks.
   *
   * A missed loopback is a device the headphone rule still has to catch. A
   * false positive on a real microphone makes the tool refuse to record a
   * legitimate interview — and a safety check that fires on the normal case is
   * a safety check that gets switched off. These names must pass.
   */
  it.each([
    'MacBook Pro Microphone',
    'AirPods Pro',
    'Andre’s AirPods',
    'Blue Yeti',
    'Scarlett 2i2 USB',
    'Shure MV7',
    'External Microphone',
    'Jabra Evolve 65',
  ])('allows %s', (name) => {
    expect(isLoopbackDevice(name)).toBe(false)
  })

  // "Microphone" contains no needle, but a device called "Loopback" as a
  // *substring* of something innocuous would. Worth stating that the match is
  // substring-based on purpose: "BlackHole 2ch" and "BlackHole 16ch" are the
  // same device family and enumerating channel counts would be a losing game.
  it('matches a known name inside a longer one', () => {
    expect(isLoopbackDevice('Existential BlackHole 64ch (v0.6)')).toBe(true)
  })
})

describe('assertCapturable', () => {
  const mic = { id: '0', name: 'MacBook Pro Microphone' }
  const blackhole = { id: '1', name: 'BlackHole 2ch' }

  it('passes a real microphone with headphones confirmed', () => {
    expect(() => assertCapturable(mic, true)).not.toThrow()
  })

  it('refuses a loopback device even with headphones confirmed', () => {
    expect(() => assertCapturable(blackhole, true)).toThrow(LiveRefused)
  })

  it('refuses a real microphone without headphones', () => {
    expect(() => assertCapturable(mic, false)).toThrow(LiveRefused)
  })

  /**
   * The message has to say what to do next. A refusal that only says "no" gets
   * worked around by whatever is quickest, which here means turning the check
   * off — so both messages name the fix.
   */
  it('says how to proceed rather than only refusing', () => {
    expect(() => assertCapturable(blackhole, true)).toThrow(/--device|voice:devices/)
    expect(() => assertCapturable(mic, false)).toThrow(/--headphones/)
  })

  // Distinct error type so the CLI can print these plainly rather than as a
  // stack trace — this is a decision the tool made, not a crash.
  it('throws a type the caller can recognise', () => {
    try {
      assertCapturable(blackhole, true)
      expect.unreachable('should have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(LiveRefused)
    }
  })
})

describe('ffmpegSegmentArgs', () => {
  const args = ffmpegSegmentArgs(':2', '/tmp/live', 300)

  it('segments, at the requested length', () => {
    expect(args).toContain('segment')
    expect(args.join(' ')).toContain('-segment_time 300')
  })

  /**
   * Without this every segment after the first carries its offset from the
   * start of the session, and whisper reads that as a file beginning forty
   * minutes in — the transcript comes back timestamped into empty space.
   */
  it('resets timestamps per segment', () => {
    expect(args.join(' ')).toContain('-reset_timestamps 1')
  })

  // 16 kHz mono is whisper's native input, so nothing resamples. Same as
  // `ffmpegArgs` in voice/audio.ts, for the same reason.
  it('records whisper-native audio', () => {
    expect(args.join(' ')).toContain('-ar 16000')
    expect(args.join(' ')).toContain('-ac 1')
  })

  it('writes zero-padded segments into the given directory', () => {
    expect(args.at(-1)).toBe('/tmp/live/seg-%03d.wav')
  })

  it('captures from the requested device', () => {
    expect(args.join(' ')).toContain('-i :2')
  })
})

/**
 * The obvious bug, named as such in the plan.
 *
 * `readdirSync` is lexicographic, so it returns `seg-010` before `seg-002`. A
 * transcript assembled in that order is a conversation with its middle moved to
 * the front — which reads as a plausible transcript of a different interview
 * rather than as an error, and would be believed.
 */
describe('orderSegments', () => {
  it('orders numerically, not lexicographically', () => {
    const shuffled = ['seg-010.wav', 'seg-002.wav', 'seg-001.wav', 'seg-100.wav', 'seg-020.wav']
    expect(orderSegments(shuffled)).toEqual([
      'seg-001.wav',
      'seg-002.wav',
      'seg-010.wav',
      'seg-020.wav',
      'seg-100.wav',
    ])
  })

  it('ignores anything that is not a segment', () => {
    expect(orderSegments(['seg-001.wav', 'notes.md', '.DS_Store', 'seg-002.wav'])).toEqual([
      'seg-001.wav',
      'seg-002.wav',
    ])
  })

  it('survives more segments than the padding allows for', () => {
    expect(orderSegments(['seg-1000.wav', 'seg-999.wav'])).toEqual(['seg-999.wav', 'seg-1000.wav'])
  })
})

describe('isClosed', () => {
  const names = ['seg-001.wav', 'seg-002.wav', 'seg-003.wav']

  // ffmpeg holds the newest segment open while the earlier ones are complete.
  it('treats every segment but the newest as finished', () => {
    expect(isClosed(names, 'seg-001.wav')).toBe(true)
    expect(isClosed(names, 'seg-002.wav')).toBe(true)
    expect(isClosed(names, 'seg-003.wav')).toBe(false)
  })

  // A lone segment is the one being written to, whatever its size. Transcribing
  // it would produce a partial transcript that looks complete.
  it('treats a lone segment as still open', () => {
    expect(isClosed(['seg-001.wav'], 'seg-001.wav')).toBe(false)
  })

  it('is false for a name that is not there', () => {
    expect(isClosed(names, 'seg-009.wav')).toBe(false)
  })
})

describe('livePath', () => {
  const when = new Date(2026, 7, 28, 14, 30)

  it('slugifies the company and stamps the local time', () => {
    expect(livePath('Talkspace', when)).toBe('local/live/talkspace-2026-08-28-1430.md')
  })

  it('handles a company name that is not a slug', () => {
    expect(livePath('CrowdStrike (Falcon Team)', when)).toBe(
      'local/live/crowdstrike-falcon-team-2026-08-28-1430.md',
    )
  })

  // Never an empty slug, which would produce `local/live/-2026-….md`.
  it('falls back rather than producing a nameless file', () => {
    expect(livePath('!!!', when)).toBe('local/live/interview-2026-08-28-1430.md')
  })

  it('stays under local/live', () => {
    expect(livePath('../../etc/passwd', when).startsWith('local/live/')).toBe(true)
    expect(livePath('../../etc/passwd', when)).not.toContain('..')
  })

  // Minute resolution: two rounds in a day are common, two in a minute are not.
  it('separates two rounds on the same day', () => {
    const later = new Date(2026, 7, 28, 16, 5)
    expect(livePath('Talkspace', when)).not.toBe(livePath('Talkspace', later))
  })
})

describe('closedSegments and capturedBytes', () => {
  it('reads segments off disk in order, excluding the open one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'))
    for (const name of ['seg-010.wav', 'seg-002.wav', 'seg-001.wav']) {
      writeFileSync(join(dir, name), 'x'.repeat(10))
    }
    writeFileSync(join(dir, 'notes.md'), 'ignored')
    expect(closedSegments(dir, 'seg-010.wav')).toEqual(['seg-001.wav', 'seg-002.wav'])
    expect(capturedBytes(dir, ['seg-001.wav', 'seg-002.wav'])).toBe(20)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not throw on a file that vanished mid-read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'))
    expect(capturedBytes(dir, ['seg-001.wav'])).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * `recordSegmented`, with `spawn` injected so nothing here touches ffmpeg.
 */
describe('recordSegmented', () => {
  function fakeChild() {
    const handlers = new Map<string, () => void>()
    return {
      stderr: { on: vi.fn() },
      once: vi.fn((event: string, fn: () => void) => {
        handlers.set(event, fn)
      }),
      kill: vi.fn(),
      fire: (event: string) => handlers.get(event)?.(),
    }
  }

  /**
   * SIGINT, not SIGKILL. ffmpeg finalises the open segment's wav header on
   * SIGINT; killed outright it leaves a header claiming a length the file does
   * not have, and whisper reads that as truncated or empty. The last segment is
   * the end of the interview, which is exactly the part worth keeping.
   */
  it('stops with SIGINT so the final segment is finalised', async () => {
    const child = fakeChild()
    const rec = recordSegmented('/tmp/x', ':0', 'ffmpeg', 300, (() => child) as never)
    const stopping = rec.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    child.fire('close')
    await expect(stopping).resolves.toBeUndefined()
  })

  // 'close' fires exactly once, so a listener attached inside stop() would miss
  // an ffmpeg that had already died and stop() would hang forever.
  it('resolves immediately when ffmpeg already exited', async () => {
    const child = fakeChild()
    const rec = recordSegmented('/tmp/x', ':0', 'ffmpeg', 300, (() => child) as never)
    child.fire('close')
    await expect(rec.stop()).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reports nothing rather than throwing when the directory is gone', () => {
    const child = fakeChild()
    const rec = recordSegmented('/nope/missing', ':0', 'ffmpeg', 300, (() => child) as never)
    expect(rec.written()).toEqual([])
  })
})
