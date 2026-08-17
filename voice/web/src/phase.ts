import type { ErrorKind, Mode, Phase } from './types'

/**
 * Splits the hook's `listening-to-interviewer` into the handoff's `ready`
 * and `speaking` using the `interviewerSpeaking` flag the hook already
 * tracks — see the comment on `Phase` in types.ts for why no new hook state
 * was needed for this.
 */
export function derivePhase(mode: Mode, interviewerSpeaking: boolean, awaitingInterviewer: boolean): Phase {
  switch (mode) {
    case 'idle':
      return 'idle'
    case 'requesting-mic':
      return 'requesting'
    case 'recording':
      return 'recording'
    case 'transcribing':
      return 'transcribing'
    case 'ended':
      return 'ended'
    case 'listening-to-interviewer':
      // Three states share this mode, and the order matters. Speaking wins: once
      // a sentence has arrived the reply is audibly under way. Otherwise a reply
      // that is owed but has not started is `thinking` — the case that used to
      // fall through to `ready` and put "Start answer" on screen before the
      // question existed. Only with nothing owed is it genuinely his turn.
      if (interviewerSpeaking) return 'speaking'
      return awaitingInterviewer ? 'thinking' : 'ready'
  }
}

/**
 * Whether to start recording without being asked.
 *
 * The interviewer stops talking and it is your turn: pressing "Start answer"
 * before speaking is a press a real interview never asks for, once per turn for
 * the length of a drill.
 *
 * This decides only whether to START. Nothing auto-stops: "Let silence sit. Do
 * not fill it. Thinking time is the exercise" is a deliberate decision — see
 * `record` in useVoiceSession.ts — and arming early leaves it untouched. A turn
 * still ends only when the candidate says it does.
 */
export function shouldAutoRecord(state: {
  phase: Phase
  /**
   * The microphone has been granted at least once this session.
   *
   * Normally true before the opening question finishes, because `acquireStream`
   * runs when the session starts — so the first turn arms as readily as the
   * tenth. Where permission was refused or there is no device it stays false,
   * and then a recording must never be what raises the prompt: the explicit
   * press is the only way in.
   */
  micReady: boolean
  /**
   * A banner is a decision — retry the transcription, or answer again from the
   * top. Arming underneath it records over a question still being read.
   */
  errorKind: ErrorKind | null
}): boolean {
  return state.phase === 'ready' && state.micReady && state.errorKind === null
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

/**
 * A timed track's budget in minutes, for display before a session exists.
 *
 * Mirrors `DESIGN_BUDGET_MS` and `CODING_BUDGET_MS` in voice/context.ts, which
 * are the authority — the client cannot import server code. Both are 45, so one
 * constant covers them; if they ever diverge this has to become per-track rather
 * than quietly showing one track the other's number.
 *
 * Display only: once a drill starts the countdown runs off the `budgetMs` the
 * server actually reported, so a drift here would show the wrong number on the
 * Idle screen and nowhere else.
 */
export const TIMED_BUDGET_MINUTES = 45

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
  // Reached on its own now, not only from a press — see `shouldAutoRecord`. The
  // second half is the part that has not changed and is the part that matters.
  recording:
    'Recording your answer. Press space when you are finished. Nothing will stop the recording for you.',
  speaking: 'Interviewer speaking.',
  // Announced only where the microphone did not arm itself — a refused
  // permission, or a banner waiting on a decision.
  ready: 'Interviewer finished. Press space to start your answer.',
  ended: 'Session ended. Transcript saved.',
  turnSaved: (duration: string): string => `Answer saved, ${duration}. Interviewer is preparing a reply.`,
  transcribing: 'Answer recorded. Transcribing it now — nothing is being recorded.',
  thinking: 'Transcribed. Waiting for the interviewer to reply.',
}
