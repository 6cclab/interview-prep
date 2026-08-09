import { describe, expect, it } from 'vitest'
import { derivePhase, fmt, wallClock, ANNOUNCEMENTS } from './phase'
import type { Mode, Phase } from './types'

/**
 * `derivePhase` had no tests, which is how two silent waits survived: the mode
 * `listening-to-interviewer` meant three different things and derived to
 * `ready` for two of them, so the screen offered "Start answer" while the
 * interviewer was still generating its reply — and again at session start,
 * before the opening question existed.
 */

const MODES: Mode[] = ['idle', 'requesting-mic', 'recording', 'transcribing', 'listening-to-interviewer', 'ended']

describe('derivePhase', () => {
  it.each([
    ['idle', 'idle'],
    ['requesting-mic', 'requesting'],
    ['recording', 'recording'],
    ['transcribing', 'transcribing'],
    ['ended', 'ended'],
  ] as [Mode, Phase][])('maps %s to %s regardless of the interviewer', (mode, phase) => {
    for (const speaking of [false, true]) {
      for (const awaiting of [false, true]) {
        expect(derivePhase(mode, speaking, awaiting)).toBe(phase)
      }
    }
  })

  describe('listening-to-interviewer, the mode that carries three states', () => {
    it('is his turn only when no reply is owed', () => {
      expect(derivePhase('listening-to-interviewer', false, false)).toBe('ready')
    })

    // The defect this whole phase exists for: a reply owed but not started.
    it('is thinking when a reply is owed and has not started', () => {
      expect(derivePhase('listening-to-interviewer', false, true)).toBe('thinking')
    })

    it('is speaking once a sentence has arrived', () => {
      expect(derivePhase('listening-to-interviewer', true, false)).toBe('speaking')
    })

    // Speaking wins: the flag is cleared by the first sentence, so both being
    // set is a momentary overlap, and "speaking" is the truthful one.
    it('prefers speaking over thinking when both are set', () => {
      expect(derivePhase('listening-to-interviewer', true, true)).toBe('speaking')
    })
  })

  // Any mode deriving to `ready` or `recording` is a mode that puts a live
  // button on screen. Only the two that should may.
  it('offers a live control in no mode other than listening-to-interviewer, recording, idle and ended', () => {
    const live: Phase[] = ['ready', 'recording', 'idle', 'ended']
    for (const mode of MODES) {
      for (const awaiting of [false, true]) {
        const phase = derivePhase(mode, false, awaiting)
        if (!live.includes(phase)) continue
        expect(['listening-to-interviewer', 'recording', 'idle', 'ended']).toContain(mode)
      }
    }
  })

  it('never returns anything outside the Phase union', () => {
    const known: Phase[] = ['idle', 'requesting', 'ready', 'recording', 'transcribing', 'thinking', 'speaking', 'ended']
    for (const mode of MODES) {
      for (const speaking of [false, true]) {
        for (const awaiting of [false, true]) {
          expect(known).toContain(derivePhase(mode, speaking, awaiting))
        }
      }
    }
  })
})

describe('ANNOUNCEMENTS', () => {
  // Each wait phase needs something for a screen reader to say, or the wait is
  // silent for exactly the users who cannot see a greyed-out control.
  it('has a line for every wait the screen can sit in', () => {
    for (const key of ['requesting', 'recording', 'transcribing', 'thinking', 'speaking', 'ready', 'ended'] as const) {
      expect(ANNOUNCEMENTS[key]).toBeTruthy()
    }
  })

  it('says nothing is recording while transcribing', () => {
    expect(ANNOUNCEMENTS.transcribing.toLowerCase()).toContain('nothing is being recorded')
  })
})

describe('fmt', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [125, '2:05'],
    [3600, '60:00'],
  ])('formats %i as %s', (seconds, expected) => {
    expect(fmt(seconds)).toBe(expected)
  })

  it('clamps a negative to zero rather than printing a minus', () => {
    expect(fmt(-5)).toBe('0:00')
  })
})

describe('wallClock', () => {
  it('pads to 24-hour hh:mm', () => {
    expect(wallClock(new Date(2026, 7, 9, 7, 41))).toBe('07:41')
    expect(wallClock(new Date(2026, 7, 9, 19, 5))).toBe('19:05')
  })
})
