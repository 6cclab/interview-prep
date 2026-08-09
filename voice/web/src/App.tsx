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
import { Home } from './components/Home'
import { History } from './components/History'
import { HomeHeader } from './components/HomeHeader'
import { ProblemPane } from './components/ProblemPane'
import { CodingTools } from './components/CodingTools'
import { routeDrill, routeHash, useRoute, type Route } from './route'
import { useTheme } from './theme'
import { derivePhase, fmt, wallClock, stuckBody, TIMED_BUDGET_MINUTES, ERROR_COPY, ANNOUNCEMENTS } from './phase'
import type { ErrorKind } from './types'

// Status title/detail for the dock's left-hand block. The `requesting`
// detail's short/long split mirrors the watchdog already in
// useVoiceSession.ts (`MIC_WATCHDOG_MS`/`MIC_WATCHDOG_MESSAGE`) — see
// `requestingLong` below for how the ~4s threshold is reconciled with that
// hook-owned status string instead of duplicating a second timer.
// The "Show me where" expansion for a blocked microphone. Chrome is named
// because .claude/CLAUDE.md makes it the supported browser for this drill; the
// second line covers the macOS layer, which is a separate grant from the site
// permission and the one that actually bites (see the same file's notes).
const PERMISSION_HELP = [
  'In Chrome: click the padlock (or the sliders icon) at the left of the address bar, find Microphone, and set it to Allow. The page does not need reloading.',
  'If it is already set to Allow, the block is one level up: System Settings › Privacy & Security › Microphone, and switch Chrome on there.',
]

const REQUESTING_LONG_COPY =
  'The browser is still asking. Nothing is being recorded yet, and this will wait as long as it needs to. If you ' +
  'cannot see the prompt, it may be behind this window, or collapsed into the padlock icon in the address bar — ' +
  'open that and choose Allow. You can leave this sitting here.'

/**
 * The router shell. `home` is the drill chooser; every other route is the drill
 * screen, which is one component for both tracks because all of it but the
 * problem pane and the clock is shared — see `Home` for why the chooser is not.
 *
 * `key` on the drill screen is the route, so switching drills remounts it rather
 * than carrying one track's session state into the other's screen.
 */
export default function App() {
  const [route, navigate] = useRoute()
  const [dark, toggleTheme] = useTheme()

  if (route.view === 'home') {
    // Both views share `.app-root`: it is the full-height flex column that makes
    // a sticky header and a single scrolling region work, and #root is
    // `height: 100vh; overflow: hidden`, so rendering outside it would leave the
    // chooser with no height to scroll inside.
    return (
      <div className="app-root">
        <HomeHeader dark={dark} onToggleTheme={toggleTheme} />
        <Home onChoose={navigate} />
      </div>
    )
  }
  // Not a drill screen: it has no session, no clock and no microphone, so it
  // shares nothing with DrillScreen but the shell.
  if (route.view === 'history') {
    return (
      <div className="app-root">
        <HomeHeader dark={dark} onToggleTheme={toggleTheme} />
        <History onGoHome={() => navigate({ view: 'home' })} />
      </div>
    )
  }
  return <DrillScreen key={routeHash(route)} route={route} dark={dark} onToggleTheme={toggleTheme} onGoHome={() => navigate({ view: 'home' })} />
}

/**
 * The header's naming, per view. A table rather than nested ternaries: with three
 * tracks the conditional version had to be read twice to see which branch was
 * the behavioural one.
 */
const HEADER = {
  mock: { title: 'Mock interview', kicker: 'Behavioral · voice' },
  design: { title: 'Design interview', kicker: 'System design' },
  coding: { title: 'Coding interview', kicker: 'Coding' },
  // Neither `home` nor `history` reaches DrillScreen, but the record is keyed by
  // the full Route view so a new view cannot be added without deciding what the
  // header says. Adding `history` to Route is what made the compiler ask.
  home: { title: 'Mock interview', kicker: 'Behavioral · voice' },
  history: { title: 'Past drills', kicker: 'Coding drill log' },
} as const

interface DrillScreenProps {
  route: Route
  dark: boolean
  onToggleTheme(): void
  onGoHome(): void
}

function DrillScreen({ route, dark, onToggleTheme, onGoHome }: DrillScreenProps) {
  const {
    mode,
    entries,
    elapsedSeconds,
    interviewerSpeaking,
    awaitingInterviewer,
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
    stuckSession,
    reopenStuckSession,
    runTests,
    verdict,
    testsRunning,
    askForHint,
    hintRung,
    hintPending,
    drill,
    remainingSeconds,
    starting,
    inputDevices,
    selectedInputId,
    selectInput,
    outputDevices,
    selectedOutputId,
    selectOutput,
  } = useVoiceSession()

  // The drill this screen runs, from the route rather than from a picker: the
  // route is the single source of truth for which track this is, which is what
  // lets a reload land back on the same drill.
  const routed = routeDrill(route)
  const [micCheckOpen, setMicCheckOpen] = useState(false)
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false)

  const phase = derivePhase(mode, interviewerSpeaking, awaitingInterviewer)
  const timed = route.view === 'design' || route.view === 'coding'
  // Narrowing once, so the header and the pane do not each re-derive it.
  const problem = 'problem' in route ? route.problem : ''
  // Whether this track has a problem statement to show — the same two tracks that
  // are timed, but derived separately because they are different questions.
  const hasPane = route.view === 'design' || route.view === 'coding'
  // A session exists to act on. Withheld before and after, because a live button
  // that 404s is worse than a disabled one.
  const live = phase !== 'idle' && phase !== 'ended'

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
      // `starting` guards the async gap: `start` is a request, and a second
      // press before it settles would race its own session into a 409 against
      // itself. Space triggers this handler too, so the guard has to live here
      // rather than only on the button.
      if (starting) return
      setSessionSeconds(0)
      // The routed drill, so this one button starts whichever track this screen
      // is. `routed` is only null on `home`, which has no primary action.
      start(routed ?? undefined)
    } else if (phase === 'ready') record()
    else if (phase === 'recording') onStopAndSubmit()
  }, [phase, start, record, onStopAndSubmit, routed, starting])

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
      else if (phase === 'transcribing' && prev === 'recording') {
        setAnnouncement(ANNOUNCEMENTS.turnSaved(fmt(pendingDurationRef.current ?? 0)))
      } else if (phase === 'thinking') setAnnouncement(ANNOUNCEMENTS.thinking)
      else if (phase === 'speaking') setAnnouncement(ANNOUNCEMENTS.speaking)
      else if (phase === 'ready' && prev === 'speaking') setAnnouncement(ANNOUNCEMENTS.ready)
      else if (phase === 'ended') setAnnouncement(ANNOUNCEMENTS.ended)
      prevPhaseRef.current = phase
    }
  }, [phase])

  // Assertive live-region text: the error's title, per the handoff.
  const alertText = errorKind ? ERROR_COPY[errorKind].title : ''

  // "Show me where" (error 1): the handoff's second action for a blocked
  // microphone. It cannot open the browser's permission UI — no web API can —
  // so it expands the concrete steps for this browser inline instead of
  // navigating somewhere that does not exist.
  const [showPermissionHelp, setShowPermissionHelp] = useState(false)
  useEffect(() => {
    if (errorKind !== 'denied') setShowPermissionHelp(false)
  }, [errorKind])

  // Recovery actions per error kind. Every action here does something real.
  const errorActions = useMemo((): ErrorAction[] => {
    if (!errorKind) return []
    const kind: ErrorKind = errorKind
    switch (kind) {
      case 'denied':
        return [
          {
            label: 'Try again',
            variant: 'brand',
            onClick: () => {
              dismissError()
              if (phase === 'ready' || phase === 'recording') record()
            },
          },
          {
            label: showPermissionHelp ? 'Hide the steps' : 'Show me where',
            variant: 'outline',
            onClick: () => setShowPermissionHelp((open) => !open),
          },
        ]
      case 'nodevice':
        return [
          {
            label: 'Check again',
            variant: 'brand',
            onClick: () => {
              dismissError()
              if (phase === 'ready' || phase === 'recording') record()
            },
          },
          // The handoff's "Read transcript": the banner's own copy promises
          // "you can keep reading the transcript in the meantime", and the
          // banner is what covers it. Dismissing is exactly that — the session
          // is untouched and the transcript is already on screen behind it.
          { label: 'Read transcript', variant: 'outline', onClick: dismissError },
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
        return [
          { label: 'End it and start fresh', variant: 'brand', onClick: forceEndStuckSession },
          // Real now that `GET /api/session/:id` can hand back the session's
          // committed entries — reopening restores the transcript and attaches
          // to the live stream. Offered only when the 409 named a session to
          // open; a server build whose 409 carries no id leaves this out rather
          // than rendering a button with nothing to act on.
          ...(stuckSession
            ? [{ label: 'Open that session', variant: 'outline' as const, onClick: reopenStuckSession }]
            : []),
        ]
    }
  }, [
    errorKind,
    phase,
    dismissError,
    record,
    retryTranscription,
    abandonTurn,
    forceEndStuckSession,
    stuckSession,
    reopenStuckSession,
    showPermissionHelp,
  ])

  let statusTitle = 'Not started'
  let statusDetail = 'The first question is asked out loud. Nothing is recorded until you start a turn.'
  if (starting) {
    statusTitle = 'Starting the session'
    statusDetail = 'Asking the server for a session. The microphone has not been touched yet.'
  } else if (phase === 'requesting') {
    statusTitle = 'Waiting for the microphone'
    statusDetail = requestingLong ? REQUESTING_LONG_COPY : 'Your browser is asking for permission. Nothing is being recorded yet.'
  } else if (phase === 'recording') {
    statusTitle = 'Recording your answer'
    statusDetail = 'Press the button, or space, when you have finished. Silence does not end the turn.'
  } else if (phase === 'transcribing') {
    statusTitle = 'Transcribing your answer'
    statusDetail = 'The recording has stopped and is being turned into text. Nothing is being recorded.'
  } else if (phase === 'thinking') {
    statusTitle = 'Interviewer is thinking'
    statusDetail = 'Your answer went through. The reply is being written and will start speaking on its own.'
  } else if (phase === 'speaking') {
    statusTitle = 'Interviewer is speaking'
    statusDetail = 'The reply is being spoken and written out as it goes.'
  } else if (phase === 'ready') {
    statusTitle = 'Your turn'
    // The behavioural drill deliberately promises no clock ("thinking time is
    // the exercise"). The timed tracks are the opposite, and repeating "no
    // countdown" while a countdown runs in the header would be a straightforward
    // lie. Keyed off `remainingSeconds` rather than the route, so it is right for
    // any timed track without enumerating them.
    statusDetail =
      remainingSeconds === null
        ? 'Start when you are ready. There is no time limit and no countdown.'
        : 'Start when you are ready. Silence does not end a turn — the clock in the header is the only limit.'
  } else if (phase === 'ended') {
    statusTitle = 'Session ended'
    // "N turns" counts Andre's answers, not transcript entries: an entry is a
    // single speaker's block, so `entries.length` counted the interviewer's
    // questions too and roughly doubled the real figure.
    const turns = entries.filter((entry) => entry.speaker === 'andre').length
    statusDetail = `Transcript saved — ${turns} turns, ${fmt(endedSessionSecondsRef.current)} total.`
  }

  return (
    <>
      <LiveRegions announcement={announcement} alertText={alertText} />

      {phase === 'recording' && <RecordingChrome />}

      {/* `--split` on the shell, not just on the body: it rebinds `--measure` (see
          styles.css), so the dock, the error banner and the drill tools widen to
          the same block the two columns occupy and share its edges. Centring them
          on the viewport instead left the dock visibly out of line with both
          columns on a wide screen. */}
      <div className={`app-root${hasPane ? ' app-root--split' : ''}`}>
        <Header
          sessionSeconds={sessionSeconds}
          remainingSeconds={remainingSeconds}
          // Only before the countdown exists, and only on a timed track.
          budgetMinutes={timed && remainingSeconds === null ? TIMED_BUDGET_MINUTES : null}
          // From the route, not the live drill: the header must name the track
          // before a session exists, not just once one is running.
          title={HEADER[route.view].title}
          kicker={timed ? `${HEADER[route.view].kicker} · ${problem}` : HEADER[route.view].kicker}
          // Leaving a live session is `End session`'s job, not a navigation's —
          // walking away silently would abandon a transcript.
          onGoHome={phase === 'idle' || phase === 'ended' ? onGoHome : undefined}
          dark={dark}
          onToggleTheme={onToggleTheme}
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

        {/* The design track's prompt stays up for the whole drill — the reason
            this track waited for a browser. Above the transcript so it reads as
            the question the conversation is about, not as a note on it. Driven
            off the route, not off the live session, so it is on screen while
            reading the prompt before starting rather than only once a session
            exists — reading the question first is the point. */}
        {/* `--roomy` before the drill starts: with an empty transcript the prompt
            is the only thing on the page worth reading, and capping it to a
            third of the screen left half of it blank. It shrinks back once the
            conversation has something in it. */}
        {/* Wrapper so the prompt and the conversation can sit side by side once
            there is room for it — see `.drill-body` in styles.css. Stacked below
            that width, which is the only shape this had before. `--split` is on
            the wrapper rather than driven off the pane's presence, because the
            behavioural track has no pane and must keep the single column. */}
        <div className={`drill-body${hasPane ? ' drill-body--split' : ''}`}>
          {hasPane && (
            <div className={`problem-pane-slot${phase === 'idle' ? ' problem-pane-slot--roomy' : ''}`}>
              <ProblemPane problem={problem} track={route.view as 'design' | 'coding'} />
            </div>
          )}

          <main className="main-column">
            <Transcript entries={entries} interimSentences={interimSentences} streaming={interviewerSpeaking} meta={meta} />
          </main>
        </div>

        <div className="dock-stack">
          {errorKind && (
            <div className="dock-stack__row">
              <ErrorBanner
                title={ERROR_COPY[errorKind].title}
                // The stuck body is built per-409 so it can name the session's
                // real start time; every other kind is static copy.
                body={errorKind === 'stuck' ? stuckBody(stuckSession?.startedAt ?? null) : ERROR_COPY[errorKind].body}
                actions={errorActions}
                details={errorKind === 'denied' && showPermissionHelp ? PERMISSION_HELP : undefined}
              />
            </div>
          )}
          {/* The coding track only. Sits in the dock rather than beside the
              problem so it is in the same place as every other action, and stays
              on screen through `ended` so the last verdict and the hint count are
              still readable while the interviewer delivers its closing. */}
          {route.view === 'coding' && (
            <div className="dock-stack__row">
              <CodingTools
                verdict={verdict}
                running={testsRunning}
                hintRung={hintRung}
                hintPending={hintPending}
                onRun={live ? runTests : undefined}
                onHint={live ? askForHint : undefined}
              />
            </div>
          )}
          {phase === 'recording' && (
            <div className="dock-stack__row">
              <PacingBar seconds={elapsedSeconds} />
            </div>
          )}
          <Dock phase={phase} starting={starting} statusTitle={statusTitle} statusDetail={statusDetail} onEndSession={endSession} onPrimary={onPrimaryAction} />
        </div>
      </div>
    </>
  )
}
