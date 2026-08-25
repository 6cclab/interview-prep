import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'brutalkit/button'
import { useVoiceSession } from './useVoiceSession'
import { Header } from './components/Header'
import { Dock } from './components/Dock'
import { ErrorBanner, type ErrorAction } from './components/ErrorBanner'
import { RecordingChrome } from './components/RecordingChrome'
import { LiveRegions } from './components/LiveRegions'
import { MicCheck } from './components/MicCheck'
import { DeviceSettings } from './components/DeviceSettings'
import { Home } from './components/Home'
import { Practice } from './components/Practice'
import { History } from './components/History'
import { HomeHeader } from './components/HomeHeader'
import { ProblemColumn } from './components/ProblemColumn'
import { SolutionEditor } from './components/SolutionEditor'
import { useSolution, runAfterSave } from './useSolution'
import { routeDrill, routeHash, useRoute, type Route } from './route'
import { targetOwnsSpace } from './keys'
import { SessionStream } from './components/SessionStream'
import { StatusRail } from './components/StatusRail'
import { DrillToolbar } from './components/DrillToolbar'
import { buildStream, type StreamEvent } from './stream'
import { useTheme } from './theme'
import {
  derivePhase,
  deriveMoment,
  fmt,
  shouldAutoRecord,
  wallClock,
  stuckBody,
  ERROR_COPY,
  ANNOUNCEMENTS,
} from './phase'
import type { DebugVerdict, DrillVerdict, ErrorKind, ProblemTrack, RailState } from './types'

// Status title/detail for the dock's left-hand block. The `requesting`
// detail's short/long split mirrors the watchdog already in
// useVoiceSession.ts (`MIC_WATCHDOG_MS`/`MIC_WATCHDOG_MESSAGE`) — see
// `requestingLong` below for how the ~4s threshold is reconciled with that
// hook-owned status string instead of duplicating a second timer.
// The "Show me where" expansion for a blocked microphone. Chrome is named
// because AGENTS.md makes it the supported browser for this drill; the
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
  // Before `DrillScreen`, because practice is not one — no session, no voice,
  // no transcript. Keyed by problem so switching problems remounts rather than
  // carrying the previous buffer and conversation across.
  if (route.view === 'practice') {
    return (
      // `app-root`, the same shell home and history use. It is the element that
      // paints `var(--background)`; a `.app` class exists in no stylesheet, so
      // this screen had no background at all and fell through to the browser's
      // white — under a dark theme, which put black text on dark surfaces.
      <div className="app-root">
        <HomeHeader dark={dark} onToggleTheme={toggleTheme} />
        <Practice key={route.problem} problem={route.problem} onGoHome={() => navigate({ view: 'home' })} />
      </div>
    )
  }

  return <DrillScreen key={routeHash(route)} route={route} dark={dark} onToggleTheme={toggleTheme} onGoHome={() => navigate({ view: 'home' })} />
}

/**
 * Everything that differs between tracks, in one row each.
 *
 * All six tracks render the *same* drill screen — that is the design, not an
 * accident — so what varies between them is configuration rather than
 * structure. Spreading that configuration across a dozen `route.view === ...`
 * expressions meant the answer to "what is different about the pairing track?"
 * lived in eleven places, and adding a seventh track meant finding all of them.
 * A row per track puts the whole answer on one screen and makes the compiler
 * ask the question for you: a new view cannot be added without filling one in.
 *
 * `home` and `history` never reach `DrillScreen`, but they are keyed anyway for
 * that last reason. Their drill fields are the inert defaults.
 */
interface TrackConfig {
  title: string
  kicker: string
  /** What the other voice is called. See SessionStream's `partner`. */
  partner: string
  /**
   * Minutes on the clock, or null when the track is untimed.
   *
   * Mirrors `DESIGN_BUDGET_MS`, `CODING_BUDGET_MS` and `ASSISTED_BUDGET_MS` in
   * voice/context.ts, which are the authority — the client cannot import server
   * code. Display only: once a drill starts the countdown runs off the
   * `budgetMs` the server actually reported, so a drift here would show the
   * wrong number on the Idle screen and nowhere else.
   *
   * This was a `view === 'assisted' ? 60 : 45` helper until the table absorbed
   * it, and before that a single constant whose comment had already called the
   * split: "if they ever diverge this has to become per-track rather than
   * quietly showing one track the other's number." A column is the form that
   * makes a third number cost nothing.
   */
  budgetMinutes: number | null
  /**
   * Which problem statement the pane fetches, or null for no pane. Coaching
   * shows one for the same reason the drills do — you cannot pair on a question
   * that has scrolled away.
   */
  paneTrack: ProblemTrack | null
  /** Whether the run/hint toolbar renders at all. */
  tools: boolean
  /**
   * Whether help is rationed. Pairing omits the ladder rather than disabling it:
   * a greyed-out "Ask for a hint" advertises a cost that does not exist there.
   */
  rationed: boolean
  runLabel: string
  /** Debugging's ladder runs out after the first rung — past it there is nothing to ration. */
  ladderRunsOut: boolean
  /** Debugging has its own verdict taxonomy, with two kinds of green. */
  debugVerdicts: boolean
  /** Coding's Run must flush the browser editor to disk first — see `onRunTests`. */
  saveBeforeRun: boolean
  /**
   * Whether the picker offers this track the browser editor at all. Only the
   * choice is per-track; whether it was *taken* is a property of the started
   * session (`drill.editor`), not of the route, because it is chosen at start.
   */
  offersEditor: boolean
}

const UNTRACKED = {
  partner: 'Interviewer',
  budgetMinutes: null,
  paneTrack: null,
  tools: false,
  rationed: false,
  runLabel: 'Run tests',
  ladderRunsOut: false,
  debugVerdicts: false,
  saveBeforeRun: false,
  offersEditor: false,
} as const

const TRACK: Record<Route['view'], TrackConfig> = {
  mock: { ...UNTRACKED, title: 'Mock interview', kicker: 'Behavioral · voice' },
  design: {
    ...UNTRACKED,
    title: 'Design interview',
    kicker: 'System design',
    budgetMinutes: 45,
    paneTrack: 'design',
  },
  coding: {
    ...UNTRACKED,
    title: 'Coding interview',
    kicker: 'Coding',
    budgetMinutes: 45,
    paneTrack: 'coding',
    tools: true,
    rationed: true,
    saveBeforeRun: true,
    offersEditor: true,
  },
  coach: {
    ...UNTRACKED,
    // Not "interview": the header is the first thing that says which mode this
    // is, and the whole point of the track is that it is not one.
    title: 'Pairing session',
    kicker: 'Coaching · unrationed',
    partner: 'Coach',
    paneTrack: 'coach',
    tools: true,
  },
  debug: {
    ...UNTRACKED,
    // "Debugging round", not "Debugging interview": the thing being rehearsed is
    // the "here is some code, something is wrong with it" round.
    title: 'Debugging round',
    kicker: 'Root cause, not symptom',
    // 45, matching `DEBUG_BUDGET_MS` in voice/context.ts. The predecessor of
    // this table derived `timed` as `design || coding || assisted` and left
    // `debug` out, so the idle screen showed no budget badge and the rail read
    // "spoken" — while the server had been handing the session a 45-minute
    // countdown all along. Writing the tracks out as rows is what surfaced it.
    budgetMinutes: 45,
    paneTrack: 'debug',
    tools: true,
    rationed: true,
    runLabel: 'Run both suites',
    ladderRunsOut: true,
    debugVerdicts: true,
  },
  assisted: {
    ...UNTRACKED,
    // The kicker names what is actually scored, because "AI-assisted" on its own
    // reads as the easy mode and it is the opposite of one.
    title: 'AI-assisted round',
    kicker: 'Judgement, not recall',
    // An hour, not the drills' 45 minutes: driving an agent to an answer and
    // then defending it does not fit in a coding round's budget.
    budgetMinutes: 60,
    paneTrack: 'assisted',
  },
  // Present for the type, and read by nothing: practice has its own screen and
  // never reaches `DrillScreen`. A row rather than an exception, so the table
  // stays "every view has one" and the next reader does not have to find out
  // why one is missing.
  practice: { ...UNTRACKED, title: 'Practice', kicker: 'Write code · nothing recorded' },
  home: { ...UNTRACKED, title: 'Mock interview', kicker: 'Behavioral · voice' },
  history: { ...UNTRACKED, title: 'Past drills', kicker: 'Coding drill log' },
}

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
    micReady,
    hasAnswered,
    dismissError,
    retryTranscription,
    abandonTurn,
    // Drives the rail's recoverable state: the audio is retained server-side, so
    // the round carries on around this rather than stopping for it.
    transcriptFailed,
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
    hintsExhausted,
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
  // One lookup for everything this track does differently. See `TRACK`.
  const track = TRACK[route.view]
  const timed = track.budgetMinutes !== null
  // Narrowing once, so the header and the pane do not each re-derive it.
  const problem = 'problem' in route ? route.problem : ''
  // A session exists to act on. Withheld before and after, because a live button
  // that 404s is worse than a disabled one.
  const live = phase !== 'idle' && phase !== 'ended'

  // The browser editor, coding track only, and only once the drill said it is
  // in `browser` mode — that is a property of the started session (`drill`),
  // not of the route, because it is chosen at start (Task 4).
  const editorMode = track.offersEditor ? drill?.editor : undefined
  const solution = useSolution(problem, editorMode === 'browser')

  // Which of the three moments the screen is in. Derived, never stored — see
  // `deriveMoment`. It drives the attention model in CSS via a data attribute
  // on the root, so no component has to know about opacity.
  const moment = deriveMoment(phase)

  /**
   * What the rail is showing.
   *
   * One slot, and the save conflict outranks a failed transcription when both
   * are true. A conflict is the only one of the two that can silently destroy
   * work — autosave is suspended until it is answered, so every keystroke after
   * it is unsaved — while a failed turn has already been retained server-side
   * and can be retried whenever. The louder problem gets the rail.
   */
  const railState: RailState =
    solution.status === 'conflict' ? 'save-conflict' : transcriptFailed ? 'transcription-failed' : 'idle'

  // Nothing at all in the browser editor. This used to read "Browser editor ·
  // no type checking — solution.ts saved": the first half is true, unchanging,
  // and obvious from the editor being on screen, and the second half is already
  // rendered on the editor's own header a few pixels below. The rail keeps its
  // fixed height either way, so removing the text moves nothing — and the two
  // states worth interrupting for, a save conflict and a failed transcription,
  // still take it over.
  const railIdleText =
    editorMode === 'browser'
      ? undefined
      : `${track.kicker} · ${track.budgetMinutes === null ? 'spoken' : `${track.budgetMinutes} minutes, spoken`}`
  const onRunTests = useCallback(() => {
    void runAfterSave(editorMode, solution.save, async () => {
      runTests()
    })
  }, [editorMode, solution.save, runTests])

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

  /**
   * The round's events, accumulated so they can be placed in time.
   *
   * The hook reports the *latest* verdict and a hint *count*: neither can say
   * when it happened, so neither could join a chronological record. Watching the
   * transitions here turns both into events without giving the hook a second
   * copy of state it already owns — it stays the source of truth for what is
   * true now, and this is the log of how it got there.
   */
  const [events, setEvents] = useState<StreamEvent[]>([])
  const lastVerdictRef = useRef<typeof verdict>(null)
  const lastRungRef = useRef(0)
  // Read rather than depended on: making the clock a dependency of the effects
  // below would re-run them every second and append the same verdict once a
  // tick for the rest of the drill.
  const secondsRef = useRef(0)
  secondsRef.current = sessionSeconds

  useEffect(() => {
    if (verdict === null || verdict === lastVerdictRef.current) return
    lastVerdictRef.current = verdict
    const at = secondsRef.current * 1000
    setEvents((prior) =>
      track.debugVerdicts
        ? [...prior, { kind: 'debug-verdict' as const, at, verdict: verdict as DebugVerdict }]
        : [...prior, { kind: 'verdict' as const, at, verdict: verdict as DrillVerdict }]
    )
  }, [verdict, track.debugVerdicts])

  useEffect(() => {
    if (hintRung <= lastRungRef.current) {
      lastRungRef.current = hintRung
      return
    }
    const rung = hintRung
    lastRungRef.current = rung
    setEvents((prior) => [...prior, { kind: 'hint' as const, at: secondsRef.current * 1000, rung }])
  }, [hintRung])

  // A new session is a new record. Without this, a second drill in the same tab
  // would open still showing the previous one's verdicts.
  useEffect(() => {
    if (phase !== 'idle') return
    setEvents([])
    lastVerdictRef.current = null
    lastRungRef.current = 0
  }, [phase, problem])

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

  /**
   * The record, and one display timestamp per line of it.
   *
   * `meta` is indexed by *turn*, and the stream interleaves events between the
   * turns, so the two cannot share an index. Rather than thread an origin index
   * through `buildStream` — which would make a pure ordering function carry a
   * presentation concern — the walk below consumes `meta` in turn order as it
   * meets speech entries, which is sound precisely because `buildStream` is
   * order-preserving.
   */
  const stream = useMemo(() => buildStream(entries, events), [entries, events])
  const streamMeta = useMemo(() => {
    let turn = 0
    return stream.map((entry) =>
      entry.kind === 'speech' ? (meta[turn++] ?? '') : fmt(Math.round(entry.at / 1000))
    )
  }, [stream, meta])

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

  // Between turns the microphone opens itself. The opening answer still takes a
  // press — beginning is deliberate, continuing is not, which is how a real
  // interview goes.
  //
  // Only the start of a turn. Nothing here stops a recording: "Let silence sit.
  // Do not fill it. Thinking time is the exercise" (see `record`) still holds,
  // and a turn ends when Andre says it does. `shouldAutoRecord` owns every
  // condition; this only obeys them.
  useEffect(() => {
    if (shouldAutoRecord({ phase, micReady, errorKind, hasAnswered })) record()
  }, [phase, micReady, errorKind, hasAnswered, record])

  // Space triggers the primary action from anywhere on the page, per the
  // handoff — suppressed when focus is somewhere that Space means something
  // else, in which case that element's own key handling applies.
  //
  // `targetOwnsSpace` decides; see keys.ts for why a tag-name check alone was
  // not enough once the browser editor landed.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat) return
      if (targetOwnsSpace(event.target as HTMLElement | null)) return
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
      // Only when Andre actually has to do something. With the microphone armed
      // this phase lasts a tick before `recording` announces itself, and
      // "press space to start your answer" would be both wrong and the first
      // of two sentences in a row.
      else if (phase === 'ready' && prev === 'speaking' && !shouldAutoRecord({ phase, micReady, errorKind, hasAnswered })) {
        setAnnouncement(ANNOUNCEMENTS.ready)
      }
      else if (phase === 'ended') setAnnouncement(ANNOUNCEMENTS.ended)
      prevPhaseRef.current = phase
    }
  }, [phase, micReady, errorKind, hasAnswered])

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
  const partner = track.partner
  let statusDetail =
    partner === 'Coach'
      ? 'The coach opens out loud. Nothing is recorded until you start.'
      : 'The first question is asked out loud. Nothing is recorded until you start.'
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
    statusTitle = `${partner} is thinking`
    statusDetail = 'Your answer went through. The reply is being written and will start speaking on its own.'
  } else if (phase === 'speaking') {
    statusTitle = `${partner} is speaking`
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
        ? 'Start when you are ready. No time limit.'
        : 'Start when you are ready. Silence does not end a turn.'
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
      {/* Structure 1a. Five rows at 100vh: header, the always-present status
          rail, the body, and the dock. `data-moment` is the only thing the
          attention model needs — every opacity shift is keyed off it in CSS, so
          no component below has to know the screen dims at all. */}
      <div className="drill" data-moment={moment}>
        <Header
          sessionSeconds={sessionSeconds}
          remainingSeconds={remainingSeconds}
          // Only before the countdown exists, and only on a timed track.
          budgetMinutes={remainingSeconds === null ? track.budgetMinutes : null}
          // From the route, not the live drill: the header must name the track
          // before a session exists, not just once one is running.
          title={track.title}
          kicker={timed ? `${track.kicker} · ${problem}` : track.kicker}
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
        {/* The reserved rail. Always 28px of layout, so a banner recolours it in
            place instead of inserting a box and shoving the columns mid-drill —
            which is what both of these states used to do. */}
        <StatusRail
          state={railState}
          idleText={railIdleText}
          onRetryTranscription={transcriptFailed ? retryTranscription : undefined}
          onDismissTranscription={transcriptFailed ? abandonTurn : undefined}
          onOverwrite={solution.status === 'conflict' ? () => void solution.overwrite() : undefined}
          onReload={solution.status === 'conflict' ? () => void solution.reload() : undefined}
        />

        <div className="drill-body">
          {track.paneTrack !== null && (
            /* No cast: `paneTrack` is already a `ProblemTrack`, where
               `route.view` had to be asserted down to one because it can also
               be `home` or `history`. */
            <ProblemColumn
              problem={problem}
              track={track.paneTrack}
              className="drill-problem"
            />
          )}

          <main className="drill-main">
            {/* Browser-editor mode only. `own` mode keeps the candidate in their
                real editor against real types, so there is nothing to render
                here — see `editorMode` above. */}
            {editorMode === 'browser' && (
              <div className="drill-editor">
                <div className="drill-editor-head drill-label">
                  <span data-autosave={solution.status === 'conflict' ? 'paused' : undefined}>
                    {solution.status === 'conflict'
                      ? 'Autosave paused'
                      : solution.status === 'error'
                        ? 'Save failed — kept locally'
                        : 'solution.ts'}
                  </span>
                </div>
                <div className="drill-cm">
                  <SolutionEditor
                    value={solution.text}
                    onChange={solution.setText}
                    readOnly={solution.status === 'loading'}
                  />
                </div>
              </div>
            )}

            {/* Run tests and the ladder, directly under the editor rather than
                down in the dock: they act on the code, and the cost of a rung
                should be read where the code is. */}
            {track.tools && (
              <DrillToolbar
                hintRung={hintRung}
                hintPending={hintPending}
                hintsExhausted={track.ladderRunsOut ? hintsExhausted : false}
                running={testsRunning}
                onRun={live ? (track.saveBeforeRun ? onRunTests : runTests) : undefined}
                onHint={live ? askForHint : undefined}
                rationed={track.rationed}
                runLabel={track.runLabel}
              />
            )}

            <SessionStream
              stream={stream}
              interimSentences={interimSentences}
              streaming={interviewerSpeaking}
              meta={streamMeta}
              partner={track.partner}
              hintRung={hintRung}
            />
          </main>
        </div>

        {/* The four first-class errors still interrupt, because each of them
            means the drill cannot continue until it is answered — unlike the two
            rail states, which are recoverable while the round carries on. They
            sit above the dock rather than in the body so they never move the
            editor. */}
        {errorKind && (
          <div className="drill-error">
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

        <Dock
          phase={phase}
          starting={starting}
          statusTitle={statusTitle}
          statusDetail={statusDetail}
          onEndSession={endSession}
          onPrimary={onPrimaryAction}
          elapsedSeconds={phase === 'recording' ? elapsedSeconds : null}
        />
      </div>
    </>
  )
}
