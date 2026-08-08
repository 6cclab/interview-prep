import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { Header } from './components/Header'
import { Dock } from './components/Dock'
import { PacingBar } from './components/PacingBar'
import { Transcript } from './components/Transcript'
import { ErrorBanner, type ErrorAction } from './components/ErrorBanner'
import { RecordingChrome } from './components/RecordingChrome'
import { LiveRegions } from './components/LiveRegions'
import { MicCheck } from './components/MicCheck'
import { DeviceSettings } from './components/DeviceSettings'
import { useTheme } from './theme'
import { derivePhase, fmt, wallClock, ERROR_COPY, ANNOUNCEMENTS } from './phase'
import type { ErrorKind } from './types'

// Status title/detail for the dock's left-hand block. The `requesting`
// detail's short/long split mirrors the watchdog already in
// useVoiceSession.ts (`MIC_WATCHDOG_MS`/`MIC_WATCHDOG_MESSAGE`) — see
// `requestingLong` below for how the ~4s threshold is reconciled with that
// hook-owned status string instead of duplicating a second timer.
const REQUESTING_LONG_COPY =
  'The browser is still asking. Nothing is being recorded yet, and this will wait as long as it needs to. If you ' +
  'cannot see the prompt, it may be behind this window, or collapsed into the padlock icon in the address bar — ' +
  'open that and choose Allow. You can leave this sitting here.'

export default function App() {
  const {
    mode,
    entries,
    elapsedSeconds,
    interviewerSpeaking,
    interimSentences,
    errorKind,
    dismissError,
    retryTranscription,
    abandonTurn,
    start,
    record,
    stopAndSubmit,
    endSession,
    forceEndStuckSession,
    inputDevices,
    selectedInputId,
    selectInput,
    outputDevices,
    selectedOutputId,
    selectOutput,
  } = useVoiceSession()

  const [dark, toggleTheme] = useTheme()
  const [micCheckOpen, setMicCheckOpen] = useState(false)
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false)

  const phase = derivePhase(mode, interviewerSpeaking)

  // The session clock ("8:34 session" in the header) is client-side display
  // only — the wire carries no session-duration field (see the handoff
  // binding notes). Ticks whenever a session is live, freezes the instant it
  // ends so the Ended receipt can read it back.
  const [sessionSeconds, setSessionSeconds] = useState(0)
  useEffect(() => {
    if (phase === 'idle' || phase === 'ended') return
    const id = setInterval(() => setSessionSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  // The `requesting` phase can hang indefinitely (see MIC_WATCHDOG_MS in
  // useVoiceSession.ts) and its detail copy must expand to the long form
  // after ~4s without shifting the dock's layout. Rather than duplicate that
  // timer, this mirrors it on the same schedule, reset on every entry into
  // `requesting`.
  const [requestingLong, setRequestingLong] = useState(false)
  useEffect(() => {
    if (phase !== 'requesting') {
      setRequestingLong(false)
      return
    }
    const id = setTimeout(() => setRequestingLong(true), 4000)
    return () => clearTimeout(id)
  }, [phase])

  // Per-entry display metadata the wire does not carry: the candidate's
  // spoken duration and the interviewer's wall-clock arrival time. Captured
  // client-side, at the moment each is knowable — see `onStopAndSubmit`
  // (captures `elapsedSeconds` right before it would reset) and the effect
  // below (stamps `Date.now()` the instant a new `entry` event grows the
  // list). Never sent to or read from the server.
  const [meta, setMeta] = useState<string[]>([])
  const pendingDurationRef = useRef<number | null>(null)
  const prevEntryCountRef = useRef(0)

  useEffect(() => {
    if (entries.length <= prevEntryCountRef.current) {
      prevEntryCountRef.current = entries.length
      return
    }
    setMeta((prev) => {
      const next = prev.slice()
      for (let i = prevEntryCountRef.current; i < entries.length; i++) {
        const entry = entries[i]!
        if (entry.speaker === 'andre') {
          const duration = pendingDurationRef.current ?? 0
          next[i] = `${fmt(duration)} spoken`
        } else {
          next[i] = wallClock(new Date())
        }
      }
      return next
    })
    prevEntryCountRef.current = entries.length
  }, [entries])

  const onStopAndSubmit = useCallback(() => {
    pendingDurationRef.current = elapsedSeconds
    stopAndSubmit()
  }, [elapsedSeconds, stopAndSubmit])

  // Ended receipt ("Transcript saved — N turns, MM:SS total.") freezes the
  // session clock reading from the instant `ended` is reached, rather than
  // reading `sessionSeconds` live — the interval above already stops
  // ticking on `ended`, so this just captures that final value once instead
  // of letting every future render recompute the same frozen number.
  const endedSessionSecondsRef = useRef(0)
  useEffect(() => {
    if (phase === 'ended') endedSessionSecondsRef.current = sessionSeconds
  }, [phase, sessionSeconds])

  const onPrimaryAction = useCallback((): void => {
    if (phase === 'idle' || phase === 'ended') {
      setSessionSeconds(0)
      start()
    } else if (phase === 'ready') record()
    else if (phase === 'recording') onStopAndSubmit()
  }, [phase, start, record, onStopAndSubmit])

  // Space triggers the primary action from anywhere on the page, per the
  // handoff — suppressed when focus is on an interactive element (that
  // element's own key handling applies, and there are no text inputs for
  // Space to type into here).
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      onPrimaryAction()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrimaryAction])

  // Polite live-region announcements, one sentence per state change — see
  // ANNOUNCEMENTS (phase.ts) for the exact copy, lifted from the handoff's
  // accessibility examples.
  const [announcement, setAnnouncement] = useState('')
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    const prev = prevPhaseRef.current
    if (prev !== phase) {
      if (phase === 'requesting') setAnnouncement(ANNOUNCEMENTS.requesting)
      else if (phase === 'recording') setAnnouncement(ANNOUNCEMENTS.recording)
      else if (phase === 'speaking' && prev === 'recording') {
        setAnnouncement(ANNOUNCEMENTS.turnSaved(fmt(pendingDurationRef.current ?? 0)))
      } else if (phase === 'speaking') setAnnouncement(ANNOUNCEMENTS.speaking)
      else if (phase === 'ready' && prev === 'speaking') setAnnouncement(ANNOUNCEMENTS.ready)
      else if (phase === 'ended') setAnnouncement(ANNOUNCEMENTS.ended)
      prevPhaseRef.current = phase
    }
  }, [phase])

  // Assertive live-region text: the error's title, per the handoff.
  const alertText = errorKind ? ERROR_COPY[errorKind].title : ''

  // Recovery actions per error kind. Every action here does something real —
  // see the design report for the one the handoff specifies that has no
  // honest counterpart (a resumable "stuck" session to open) and was dropped
  // rather than shipped as a dead button.
  const errorActions = useMemo((): ErrorAction[] => {
    if (!errorKind) return []
    const kind: ErrorKind = errorKind
    switch (kind) {
      case 'denied':
      case 'nodevice':
        return [
          {
            label: kind === 'denied' ? 'Try again' : 'Check again',
            variant: 'brand',
            onClick: () => {
              dismissError()
              if (phase === 'ready' || phase === 'recording') record()
            },
          },
          { label: 'Dismiss', variant: 'outline', onClick: dismissError },
        ]
      case 'transcript':
        // All three of the handoff's actions are real now that the server
        // retains the failed turn's audio and stays alive (voice/http-server.ts's
        // turn/retry and turn/abandon routes): "Retry transcription" re-runs
        // transcription server-side with no re-recording; "Answer again" and
        // "Skip this turn" both drop the retained audio and return to Ready —
        // see the comment on `abandonTurn` in useVoiceSession.ts for why that
        // collapses into one server call.
        return [
          { label: 'Retry transcription', variant: 'brand', onClick: retryTranscription },
          { label: 'Answer again', variant: 'outline', onClick: abandonTurn },
          { label: 'Skip this turn', variant: 'ghost', onClick: abandonTurn },
        ]
      case 'stuck':
        // "Open that session" has no server-side counterpart — there is no
        // API to resume a stuck session's in-progress turn, only to end it —
        // so it is omitted rather than shipped inert.
        return [{ label: 'End it and start fresh', variant: 'brand', onClick: forceEndStuckSession }]
    }
  }, [errorKind, phase, dismissError, record, retryTranscription, abandonTurn, forceEndStuckSession])

  let statusTitle = 'Not started'
  let statusDetail = 'The first question is asked out loud. Nothing is recorded until you start a turn.'
  if (phase === 'requesting') {
    statusTitle = 'Waiting for the microphone'
    statusDetail = requestingLong ? REQUESTING_LONG_COPY : 'Your browser is asking for permission. Nothing is being recorded yet.'
  } else if (phase === 'recording') {
    statusTitle = 'Recording your answer'
    statusDetail = 'Press the button, or space, when you have finished. Silence does not end the turn.'
  } else if (phase === 'speaking') {
    statusTitle = 'Interviewer is speaking'
    statusDetail = 'The reply is being spoken and written out as it goes.'
  } else if (phase === 'ready') {
    statusTitle = 'Your turn'
    statusDetail = 'Start when you are ready. There is no time limit and no countdown.'
  } else if (phase === 'ended') {
    statusTitle = 'Session ended'
    statusDetail = `Transcript saved — ${entries.length} turns, ${fmt(endedSessionSecondsRef.current)} total.`
  }

  return (
    <>
      <LiveRegions announcement={announcement} alertText={alertText} />

      {phase === 'recording' && <RecordingChrome />}

      <div className="app-root">
        <Header
          sessionSeconds={sessionSeconds}
          dark={dark}
          onToggleTheme={toggleTheme}
          micCheckOpen={micCheckOpen}
          onToggleMicCheck={() => setMicCheckOpen((v) => !v)}
          deviceSettingsOpen={deviceSettingsOpen}
          onToggleDeviceSettings={() => setDeviceSettingsOpen((v) => !v)}
        />

        {deviceSettingsOpen && (
          <div className="device-settings-panel">
            <DeviceSettings
              inputDevices={inputDevices}
              selectedInputId={selectedInputId}
              onSelectInput={selectInput}
              outputDevices={outputDevices}
              selectedOutputId={selectedOutputId}
              onSelectOutput={selectOutput}
            />
          </div>
        )}

        {micCheckOpen && (
          <div className="mic-check-panel">
            <MicCheck />
          </div>
        )}

        <main className="main-column">
          <Transcript entries={entries} interimSentences={interimSentences} streaming={interviewerSpeaking} meta={meta} />
        </main>

        <div className="dock-stack">
          {errorKind && (
            <div className="dock-stack__row">
              <ErrorBanner title={ERROR_COPY[errorKind].title} body={ERROR_COPY[errorKind].body} actions={errorActions} />
            </div>
          )}
          {phase === 'recording' && (
            <div className="dock-stack__row">
              <PacingBar seconds={elapsedSeconds} />
            </div>
          )}
          <Dock phase={phase} statusTitle={statusTitle} statusDetail={statusDetail} onEndSession={endSession} onPrimary={onPrimaryAction} />
        </div>
      </div>
    </>
  )
}
