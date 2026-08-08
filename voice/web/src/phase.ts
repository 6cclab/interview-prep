import type { ErrorKind, Mode, Phase } from './types'

/**
 * Splits the hook's `listening-to-interviewer` into the handoff's `ready`
 * and `speaking` using the `interviewerSpeaking` flag the hook already
 * tracks — see the comment on `Phase` in types.ts for why no new hook state
 * was needed for this.
 */
export function derivePhase(mode: Mode, interviewerSpeaking: boolean): Phase {
  switch (mode) {
    case 'idle':
      return 'idle'
    case 'requesting-mic':
      return 'requesting'
    case 'recording':
      return 'recording'
    case 'ended':
      return 'ended'
    case 'listening-to-interviewer':
      return interviewerSpeaking ? 'speaking' : 'ready'
  }
}

/** `s` -> `m:ss`, matching the handoff's `fmt`. */
export function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 24-hour wall-clock, e.g. "07:41" — used for interviewer turn timestamps. */
export function wallClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export interface ErrorCopy {
  title: string
  body: string
}

// Titles and bodies are the handoff's exact copy (section "The four errors").
// The `stuck` body is now the handoff's full text too, including the start time
// and the "opening it puts you back where you left off" clause: the 409 from
// POST /api/session carries the refused session's id and `startedAt`, so both
// are real. `stuckBody` below is what fills the time in. The last remaining
// deviation is the fallback for a 409 with no timestamp — see there.
export const ERROR_COPY: Record<ErrorKind, ErrorCopy> = {
  denied: {
    title: 'The browser blocked microphone access',
    body: 'This page asked for the microphone and the browser refused, so nothing is being recorded. Open the site permissions from the padlock in the address bar, set Microphone to Allow, and try again. Your transcript so far is saved and the session stays where it is.',
  },
  nodevice: {
    title: 'No microphone is available on this device',
    body: 'The browser cannot see any audio input at all, which usually means nothing is plugged in, the input is disabled at the system level, or another app has taken exclusive hold of it. Connect or enable a microphone and check again — you do not need to reload, and you can keep reading the transcript in the meantime.',
  },
  transcript: {
    title: 'That answer was recorded but not transcribed',
    body: 'The recording finished and the audio is still here, but transcription failed, so this turn was not added to the transcript and the interviewer has not heard it. You can retry transcription on the audio you already gave, or answer the question again from the top. Nothing was silently dropped.',
  },
  stuck: {
    title: 'An earlier session is still open',
    body: stuckBody(null),
  },
}

/**
 * The stuck-session body, naming the session's start time when the 409 reported
 * one. Without a timestamp it says "an earlier session" instead of inventing a
 * clock reading — the handoff's "07:12" is canned prototype copy, and a wrong
 * time is worse than no time when the whole point of the banner is to tell
 * Andre which session he is about to end.
 */
export function stuckBody(startedAt: string | null): string {
  const when = startedAt ? `A session started at ${wallClock(new Date(startedAt))}` : 'An earlier session'
  return (
    `${when} was never ended, so a new one cannot start alongside it. ` +
    'Ending it now saves its transcript exactly as it stands; opening it puts you back where you left off, mid-turn.'
  )
}

// Announcement sentences for the polite live region — the handoff's exact
// examples (section "Accessibility") plus the same phrasing the design
// reference's own `say()` calls use for the states the handoff doesn't spell
// out verbatim (requesting, interviewer-speaking-started, ended).
export const ANNOUNCEMENTS = {
  requesting: 'Waiting for microphone permission. Nothing is being recorded yet.',
  recording: 'Recording your answer. Press space when you are finished. Nothing will stop the recording for you.',
  speaking: 'Interviewer speaking.',
  ready: 'Interviewer finished. Press space to start your answer.',
  ended: 'Session ended. Transcript saved.',
  turnSaved: (duration: string): string => `Answer saved, ${duration}. Interviewer is preparing a reply.`,
}
