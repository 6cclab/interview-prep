import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnyVerdict, Drill, Entry, ErrorKind, MicDevice, Mode, OutputDevice, StuckSession } from './types'
import { endOutcome } from './end-outcome'

export interface VoiceSession {
  mode: Mode
  status: string
  entries: Entry[]
  /** Seconds since the current recording started. Display only — see `record`. */
  elapsedSeconds: number
  /** True while the interviewer's reply is actively streaming in as sentences. Display only. */
  interviewerSpeaking: boolean
  /** A reply is owed but has not started arriving. See the state's comment. */
  awaitingInterviewer: boolean
  /**
   * Sentences of the interviewer's in-progress reply, one per `sentence` SSE
   * event, oldest first. Cleared the moment the matching `entry` event lands
   * with the full, final text — this exists purely so the transcript can
   * show the reply arriving progressively, one animated sentence at a time
   * (per the handoff's `sentenceIn` treatment), rather than popping in all at
   * once. Never a source of truth: `entries` (built only from `entry`
   * events) is.
   */
  interimSentences: string[]
  /** True when this browser cannot offer microphone access at all (see `mediaDevicesUnsupported`). */
  micUnsupported: boolean
  /** True after a 409 from POST /api/session — an existing session is stuck. */
  sessionConflict: boolean
  /**
   * Set from the `DOMException.name` of a rejected `getUserMedia` call — see
   * `classifyMicError`. `null` once a request is in flight or has succeeded.
   */
  micFailureKind: 'denied' | 'nodevice' | null
  /**
   * True after a 422 from `POST /turn` or `POST /turn/retry`. The server
   * (`voice/http-server.ts`) keeps the session alive on a transcription
   * failure and retains the audio for a retry — matching the handoff's
   * "parks in Ready" description exactly: `mode` stays
   * `'listening-to-interviewer'`, so `derivePhase` reports `'ready'`, and the
   * question that was being answered still stands.
   */
  transcriptFailed: boolean
  /** One computed banner selector for the presentation layer — see `ErrorKind`. */
  errorKind: ErrorKind | null
  /**
   * The session a 409 refused to start alongside, as reported by that 409's
   * body. `null` when nothing is stuck, or when the server is an older build
   * whose 409 carried no id.
   */
  stuckSession: StuckSession | null
  /**
   * The stuck-session banner's "Open that session" action: reads the session's
   * committed entries back from `GET /api/session/:id`, restores them, and
   * attaches to the live SSE stream — the handoff's "puts you back where you
   * left off, mid-turn". A no-op when `stuckSession` is null. If the session
   * ended in the meantime, clears the banner and leaves Andre at Idle rather
   * than pretending to reopen it.
   */
  reopenStuckSession(): void
  /** Dismisses the currently-showing error banner without changing `mode`. */
  dismissError(): void
  /**
   * The transcript error's "Retry transcription" action: re-runs
   * transcription on the audio already uploaded for the failed turn
   * (`POST /api/session/:id/turn/retry`), server-side, no re-recording. On
   * success, proceeds exactly like a normal turn — the existing `entry`/
   * `sentence` SSE listeners in `connectStream` pick it up with no extra
   * wiring needed. On failure, stays in the same recoverable error state.
   */
  retryTranscription(): void
  /**
   * The transcript error's "Answer again" and "Skip this turn" actions.
   * Both resolve to the same server call (`POST .../turn/abandon`), which
   * drops the retained audio and leaves the session exactly where a turn
   * that never failed would — see the design report for why the
   * distinction doesn't reach the server. The client-visible difference is
   * only what happens next: pressing the primary action records a fresh
   * answer to the same still-standing question either way.
   */
  abandonTurn(): void
  /**
   * Starts a session. Defaults to the behavioural mock when given no drill, so
   * the primary action stays a single no-argument press; the design track is an
   * explicit choice. A drill the server rejects (unknown problem, bad budget)
   * leaves the app at Idle with the reason in `status` — nothing half-starts.
   */
  start(drill?: Drill): void
  /**
   * The drill the live session is running, or `null` when nothing is live. The
   * design track needs it on screen: the problem pane reads `problem`, and the
   * countdown reads `budgetMs`.
   */
  drill: Drill | null
  /**
   * Seconds left of a timed drill's budget, or `null` when the drill is untimed.
   * Floors at zero and keeps counting no further — the interviewer is told when
   * time is up (see `timeCue`) and closes the interview itself, so the
   * clock hitting zero is not the client's cue to end anything.
   */
  remainingSeconds: number | null
  /**
   * True from the moment `start` is called until the request settles. `start` is
   * async, so without this a second press lands while the first is still in
   * flight and races its own session into a 409 against itself.
   */
  starting: boolean
  /**
   * The coding track's "Run tests" action (`POST /api/session/:id/tests`).
   *
   * Runs the drill's suite server-side and hands the verdict to the interviewer,
   * which reacts out loud — that reaction arrives through the existing
   * `sentence`/`entry` SSE listeners, so nothing extra is wired for it here.
   * The verdict is also returned so the screen can show it: a suite takes real
   * seconds and the button cannot go silent until the interviewer starts
   * speaking.
   */
  runTests(): void
  /** The most recent test run's verdict, or `null` before the first run. */
  verdict: AnyVerdict | null
  /** True while a suite is running, so the button can say so and not be pressed twice. */
  testsRunning: boolean
  /**
   * The coding track's "Ask for a hint" action (`POST /api/session/:id/hint`).
   *
   * The rung is the server's to count, not this hook's — see the route. The
   * interviewer delivers it out loud through the existing SSE listeners.
   */
  askForHint(): void
  /** Highest hint rung taken, 0-4. 0 means no help taken. */
  hintRung: number
  /** True once an ask returned nothing further to give. See `askForHint`. */
  hintsExhausted: boolean
  /** True while a hint request is in flight. */
  hintPending: boolean
  record(): void
  stopAndSubmit(): void
  /** The dock's "End session" action — ends the current session, wherever it is in its turn cycle. */
  endSession(): void
  /**
   * Recovery path for `sessionConflict`: force-ends whatever session is
   * stuck, then immediately starts a fresh one — this is what makes the
   * "stuck" banner's "End it and start fresh" action do what it says.
   */
  forceEndStuckSession(): void
  /**
   * Named microphones, per `navigator.mediaDevices.enumerateDevices()`.
   * Empty until permission has been granted at least once — device labels
   * are blank before that, and a list of blank options isn't a real choice,
   * so unnamed entries are filtered out entirely rather than shown. Refreshed
   * on `devicechange` (a headset plugged in) and right after a successful
   * `getUserMedia` call.
   */
  inputDevices: MicDevice[]
  /** The chosen microphone's `deviceId`, or `null` for "system default". */
  selectedInputId: string | null
  /**
   * Selects a microphone. Persists the choice (`POST /api/devices/config`,
   * `webInput` field) so it survives a reload, and — since `record()` reuses
   * a cached stream across turns — releases that cached stream and
   * re-acquires on the new device immediately if a session is live, so the
   * change actually takes effect rather than waiting for the next `start()`.
   */
  selectInput(deviceId: string): void
  /** Speakers, from the server's `GET /api/devices/output` (see `voice/devices.ts`). */
  outputDevices: OutputDevice[]
  /** The chosen speaker's id, or `null` for "system default". */
  selectedOutputId: string | null
  /**
   * Selects a speaker the *server* should speak through — the browser has no
   * API to route `SpeechSynthesis` to a chosen output device, so speech
   * happens server-side (see `voice/http-server.ts`'s `deps.speaker`) and
   * this only needs to persist the choice (`POST /api/devices/config`,
   * `output` field); no local audio pipeline to restart.
   */
  selectOutput(id: string): void
}

// Blank labels mean "a microphone exists, but permission hasn't been granted
// yet" (see MicCheck.tsx's identical comment) — presenting those as a real
// choice would be presenting indistinguishable "Microphone" entries as if
// they were meaningfully different options. Filtered out entirely rather
// than shown disabled/greyed, per the spec: don't present a list of blank
// options as if it were a real choice.
async function listNamedMicDevices(): Promise<MicDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput' && d.label !== '')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }))
}

interface DeviceConfigResponse {
  input?: string
  output?: string
  webInput?: string
}

async function fetchDeviceConfig(): Promise<DeviceConfigResponse | null> {
  try {
    const res = await fetch('/api/devices/config')
    if (!res.ok) return null
    return (await res.json()) as DeviceConfigResponse
  } catch {
    return null
  }
}

// Best-effort: a failed persist just means the choice won't survive a
// reload, not a reason to interrupt whatever the user was doing.
function persistDeviceConfig(patch: { output?: string; webInput?: string }): void {
  void fetch('/api/devices/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {})
}

// Safari does not treat `http://localhost` as a secure context, so
// `navigator.mediaDevices` is missing entirely rather than present-but­
// -denying. Checking for it ahead of calling `getUserMedia` lets the UI name
// the actual cause instead of surfacing a bare "Cannot read properties of
// undefined" `TypeError` from deep inside a click handler.
function mediaDevicesUnsupported(): boolean {
  return typeof navigator === 'undefined' || navigator.mediaDevices === undefined
}

// A cached stream can go bad without an explicit error: the device can be
// unplugged, or the OS can revoke access mid-session. `active` flips false
// and/or the audio track's `readyState` flips to `'ended'` when that
// happens; either is a signal to re-acquire rather than hand a dead stream
// to a new MediaRecorder.
function streamIsLive(stream: MediaStream | null): stream is MediaStream {
  return stream !== null && stream.active && stream.getAudioTracks().some((track) => track.readyState === 'live')
}

// How long `getUserMedia` gets before the watchdog in `acquireStream` below
// stops being patient and names a cause. Short enough that a genuinely stuck
// permission prompt (the reported symptom) doesn't read as a frozen page for
// long, long enough that a normal "click Allow" pause never trips it.
const MIC_WATCHDOG_MS = 4000

// Classifies a rejected `getUserMedia` call into one of the handoff's two
// permission-shaped error banners. `NotAllowedError`/`PermissionDeniedError`/
// `SecurityError` are the browser refusing an existing device; everything
// else that still names a device-shaped cause (`NotFoundError`,
// `DevicesNotFoundError`, `OverconstrainedError`) means no usable input
// exists at all. An error with none of these names is rare in practice (most
// getUserMedia rejections are one of the above); it's treated as `denied`
// since "try again" is the safer default action to offer.
function classifyMicError(error: unknown): 'denied' | 'nodevice' {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'nodevice'
  }
  return 'denied'
}

const MIC_WATCHDOG_MESSAGE =
  'Still waiting for microphone access. If Chrome never showed a permission prompt, this is almost ' +
  "always one of two things: this origin's own microphone permission is blocked or was previously " +
  'dismissed — check chrome://settings/content/microphone (permissions are per-origin, so a ' +
  'different port counts as a different site) — or Chrome itself lacks microphone access at the OS ' +
  'level (macOS: System Settings → Privacy & Security → Microphone). This request is still pending ' +
  'and will proceed on its own if access is granted.'

/**
 * Consecutive stream failures before saying so.
 *
 * One is routine: a reconnect is a supported path and recovers on its own. Two in
 * a row means it is not recovering, which is worth telling someone mid-drill.
 */
const STREAM_FAILURES_BEFORE_REPORTING = 2

export function useVoiceSession(): VoiceSession {
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('Idle.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false)
  /**
   * A reply is owed but has not started arriving.
   *
   * Separate from `interviewerSpeaking`, which only becomes true once the first
   * `sentence` lands. The gap between those two is real — a session start or a
   * submitted turn, then several seconds of generation — and without this flag
   * that gap derived to `ready`, so the screen said "your turn" while the
   * interviewer had not asked anything.
   */
  const [awaitingInterviewer, setAwaitingInterviewer] = useState(false)
  const [interimSentences, setInterimSentences] = useState<string[]>([])
  const [sessionConflict, setSessionConflict] = useState(false)
  const [micUnsupported] = useState(mediaDevicesUnsupported)
  const [micFailureKind, setMicFailureKind] = useState<'denied' | 'nodevice' | null>(null)
  const [transcriptFailed, setTranscriptFailed] = useState(false)
  // Set alongside `sessionConflict` from the 409's body: what the stuck session
  // is, so the banner can name its start time and reopening has an id to use.
  const [stuckSession, setStuckSession] = useState<StuckSession | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)
  // The countdown is driven off an absolute deadline rather than a decrementing
  // counter, so it stays honest across a backgrounded tab, a throttled timer or
  // a sleeping laptop — all of which stall interval callbacks and would
  // otherwise leave the clock reading long after the time was actually gone.
  const [starting, setStarting] = useState(false)
  const [verdict, setVerdict] = useState<AnyVerdict | null>(null)
  const [testsRunning, setTestsRunning] = useState(false)
  const [hintRung, setHintRung] = useState(0)
  const [hintsExhausted, setHintsExhausted] = useState(false)
  const [hintPending, setHintPending] = useState(false)
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (deadlineAt === null) {
      setRemainingSeconds(null)
      return
    }
    // Floors at zero: the interviewer is told when time is up and closes the
    // interview itself (see `timeCue`), so this display must not race it
    // by ending anything, and a negative number would just be noise.
    const tick = () => setRemainingSeconds(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)))
    tick()
    // Twice a second, so the visible second neither lags nor skips as the
    // interval drifts against the wall clock.
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [deadlineAt])
  const [inputDevices, setInputDevices] = useState<MicDevice[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null)
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  // A ref as well as state, for the same reason the other in-flight guards are:
  // `runTests` is a stable callback, so it would read a stale `testsRunning`
  // from the render it was created in and let a second press through.
  const testsRunningRef = useRef(false)
  const hintPendingRef = useRef(false)
  // Whether this session's `/end` is already in flight. Same reasoning as the
  // guards above, and one more: a coding drill's `/end` drives a closing
  // interviewer turn, so it is in flight for a model minute — long enough for a
  // second button press or a `beforeunload` beacon to fire a second one.
  const endingRef = useRef(false)
  // Consecutive `EventSource` failures — see the error handler in `connectStream`.
  const streamFailuresRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  // Acquired once per session (see `start`) and reused for every turn's
  // MediaRecorder — this is the fix for the "prompts every turn" complaint.
  // Only released at session end or unmount (`releaseMicStream`), never
  // between turns.
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode
  // Mirrors `selectedInputId` for `acquireStream`, which needs the value at
  // call time, not whatever it closed over — same pattern as `modeRef`.
  // Updated synchronously wherever the state itself is set (not via an
  // effect) so `selectInput`'s own immediate re-acquisition below never races
  // a stale read of its own selection.
  const selectedInputIdRef = useRef<string | null>(null)

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  // Stops the cached stream's tracks and drops the reference. Called at
  // session end and on unmount — deliberately never between turns, which is
  // the behavior this whole fix replaces.
  const releaseMicStream = useCallback(() => {
    const stream = mediaStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
    }
    mediaStreamRef.current = null
  }, [])

  /**
   * Everything that has to be true once a drill is over, minus the status line.
   *
   * Two paths reach it and they must not drift: the `ended` SSE event, which is
   * the normal way out, and a `POST /end` that came back 404 — the session was
   * already persisted and removed, so no event is coming. Before this, only the
   * first path existed, and the second reported that there was nothing left to
   * end while leaving the drill on screen.
   *
   * The caller sets `status`, because the two have different things to say.
   */
  const finishLocally = useCallback(() => {
    setInterviewerSpeaking(false)
    setAwaitingInterviewer(false)
    setInterimSentences([])
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setMode('ended')
    // The countdown stops with the session. `drill` is deliberately kept, so
    // the Ended screen can still say which problem this was.
    setDeadlineAt(null)
    releaseMicStream()
  }, [releaseMicStream])

  // Requests the microphone, watching for the permission prompt hanging
  // indefinitely (the reported symptom): after `MIC_WATCHDOG_MS`, the status
  // line gets replaced with actionable text, but the original promise is
  // never abandoned or raced against a fabricated rejection — if the user
  // grants access late, this still resolves normally and the caller
  // proceeds as if nothing happened.
  // Repopulates `inputDevices` from `navigator.mediaDevices.enumerateDevices()`.
  // Safe to call regardless of permission state: unnamed (unlabeled) entries
  // are filtered out by `listNamedMicDevices`, so calling this before a grant
  // just yields an empty list rather than a list of blank options. Also the
  // fallback path when the previously selected device has vanished (e.g. a
  // headset was unplugged) — rather than leaving a dangling id that the next
  // `getUserMedia({ deviceId: { exact } })` would reject with
  // `OverconstrainedError`, drop back to `null` ("system default").
  const refreshInputDevices = useCallback(async () => {
    if (mediaDevicesUnsupported()) return
    try {
      const named = await listNamedMicDevices()
      setInputDevices(named)
      if (selectedInputIdRef.current && !named.some((d) => d.deviceId === selectedInputIdRef.current)) {
        selectedInputIdRef.current = null
        setSelectedInputId(null)
      }
    } catch {
      // enumerateDevices() failing is rare and not worth its own error
      // banner — the selector just stays empty/stale until the next
      // successful refresh.
    }
  }, [])

  const acquireStream = useCallback(async (): Promise<MediaStream | null> => {
    if (mediaDevicesUnsupported()) return null

    setMicFailureKind(null)
    const watchdog = setTimeout(() => setStatus(MIC_WATCHDOG_MESSAGE), MIC_WATCHDOG_MS)
    const deviceId = selectedInputIdRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      clearTimeout(watchdog)
      mediaStreamRef.current = stream
      // Labels are populated the moment permission is granted — refresh now
      // so the selector shows real names instead of staying empty until some
      // unrelated `devicechange` event happens to fire.
      void refreshInputDevices()
      return stream
    } catch (error) {
      clearTimeout(watchdog)
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Microphone access failed: ${message}. You can still hear the interviewer; press the button to try again when you answer.`)
      setMicFailureKind(classifyMicError(error))
      return null
    }
  }, [refreshInputDevices])

  const connectStream = useCallback((id: string) => {
    eventSourceRef.current?.close()
    const es = new EventSource(`/api/session/${id}/stream`)
    eventSourceRef.current = es

    // Without this the page lies. `EventSource` retries a failed connection
    // forever and silently, so a stream that will never come back — the server
    // was restarted, and sessions live in memory, so the id is simply gone —
    // left the screen looking perfectly live while every action 404'd. Nothing
    // told anyone; it just stopped.
    //
    // A single failure is not reported, because a reconnect is normal and
    // recoverable (see the reconnect handling in the /stream route). Only a run
    // of them means the stream is actually dead.
    es.addEventListener('error', () => {
      // `CLOSED` means the browser has given up entirely and will not retry.
      if (es.readyState === EventSource.CLOSED) {
        setStatus('The connection to the drill server closed and will not reopen. Reload the page to start again.')
        streamFailuresRef.current = 0
        return
      }
      streamFailuresRef.current += 1
      if (streamFailuresRef.current < STREAM_FAILURES_BEFORE_REPORTING) return
      setStatus(
        'Lost the connection to the drill server — still retrying. If the server was restarted this session is ' +
          'gone; reload the page to start a new one.',
      )
    })

    // A message of any kind proves the stream is alive again.
    const clearFailures = () => {
      streamFailuresRef.current = 0
    }
    es.addEventListener('open', clearFailures)

    es.addEventListener('sentence', (event) => {
      const { text } = JSON.parse((event as MessageEvent<string>).data) as { text: string }
      setStatus('Interviewer speaking…')
      setInterviewerSpeaking(true)
      // The wait is over the moment the first sentence lands.
      setAwaitingInterviewer(false)
      // Appends for the *current* reply only — cleared below the moment the
      // matching `entry` lands. Display only, same spoiler boundary as
      // `entries`: this text originates from the same `sentence` payload the
      // server already sends, nothing new is exposed.
      setInterimSentences((prev) => [...prev, text])
      // Speech itself happens server-side now (`voice/http-server.ts`'s
      // `deps.speaker`, via `saySpeaker`) — `SpeechSynthesis` has no API to
      // route audio to a chosen output device, but the server is the same
      // machine, so it speaks instead. The browser only renders the text;
      // speaking it here too would double up two overlapping voices.
    })

    // Renders only the `speaker`/`text`/`at` fields carried by the `entry`
    // SSE event — never the assembled system prompt, and never
    // `interviewer.lastRaw()`, which carries an unstripped story-log
    // trailer. This is the client half of the spoiler gate; the server half
    // is enforced by voice/spoiler-gate.test.ts.
    es.addEventListener('entry', (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as Entry
      setEntries((prev) => [...prev, entry])
      setInterviewerSpeaking(false)
      setInterimSentences([])
    })

    es.addEventListener('ended', (event) => {
      const { endedEarly } = JSON.parse((event as MessageEvent<string>).data) as { endedEarly: string | null }
      setStatus(endedEarly ? `Session ended early: ${endedEarly}` : 'Session ended.')
      finishLocally()
    })
  }, [releaseMicStream, finishLocally])

  const start = useCallback((requested?: Drill) => {
    // Defaults to the behavioural mock, so the primary action needs no argument
    // and the design track is an explicit choice rather than a mode to fall into.
    const wanted: Drill = requested ?? { track: 'mock' }
    setSessionConflict(false)
    setMicFailureKind(null)
    setTranscriptFailed(false)
    // A new drill starts with no help taken and no test result. Carrying the previous session's
    // verdict over would show a green — or a failing test list — for code that
    // has since been reset back to the stub.
    setVerdict(null)
    setHintRung(0)
    setHintsExhausted(false)
    // A fresh session can be ended again; the previous one's latch must not
    // survive into it.
    endingRef.current = false
    setStatus('Starting session…')
    setStarting(true)
    void (async () => {
      let res: Response
      try {
        res = await fetch('/api/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(wanted),
        })
      } catch {
        // The server is not there. Report it and clear `starting`, so the
        // picker is usable again rather than locked with nothing running.
        setStatus('Could not reach the drill server.')
        setStarting(false)
        return
      }
      // Cleared here rather than in a `finally`: the request has settled, which
      // is exactly what `starting` tracks, and every branch below is
      // synchronous state-setting from this point on.
      setStarting(false)
      if (res.status === 400) {
        // The server refused the drill itself — an unknown problem, say. Nothing
        // started, so this reports and stays at Idle rather than half-entering a
        // session that does not exist.
        const { error } = (await res.json()) as { error: string }
        setStatus(`Cannot start that drill: ${error}`)
        return
      }
      if (res.status === 409) {
        // The 409 now names the session it refused, so the banner can report
        // when it started and "Open that session" has something to open.
        const conflict = (await res.json()) as { id?: string; startedAt?: string }
        setStatus('A session is already in progress.')
        setStuckSession(conflict.id ? { id: conflict.id, startedAt: conflict.startedAt ?? null } : null)
        setSessionConflict(true)
        return
      }
      const started = (await res.json()) as { id: string } & Drill
      sessionIdRef.current = started.id
      setDrill({ track: started.track, problem: started.problem, budgetMs: started.budgetMs })
      setDeadlineAt(started.budgetMs === undefined ? null : Date.now() + started.budgetMs)
      setEntries([])
      setInterviewerSpeaking(false)
      setInterimSentences([])
      // The opening question is owed before the stream has said a word, so this
      // is set alongside the connect rather than after the first sentence.
      setAwaitingInterviewer(true)
      connectStream(started.id)
      setMode('listening-to-interviewer')

      // Acquire the microphone here, on this call's real user gesture
      // (clicking "Start session"), rather than waiting for the first
      // "Record your answer" press. This is what makes reuse across turns
      // possible at all, and it also means a mic problem surfaces before
      // Andre is ever asked to speak. Deliberately fire-and-forget: a
      // failure (surfaced via `status` inside `acquireStream`) must not
      // block the session — the interviewer's opening question should
      // still play.
      if (!mediaDevicesUnsupported()) void acquireStream()
    })()
  }, [connectStream, acquireStream])

  // Recovery path for a 409 that would otherwise be a dead end: there is no
  // client-known id for the stuck session (POST /api/session's 409 body
  // never carried one), so this hits a small addition to the API surface —
  // DELETE /api/session — that ends whichever session the server currently
  // considers active, no id required.
  // The handoff's other recovery from the same banner: "opening it puts you
  // back where you left off, mid-turn." SSE replays nothing, so catching up
  // means reading the session's committed entries from `GET /api/session/:id`
  // first, then attaching to the live stream. Everything after that is an
  // ordinary in-progress session — including a turn whose transcription had
  // failed, which is why `awaitingRetry` is carried over rather than dropped.
  const reopenStuckSession = useCallback(() => {
    const stuck = stuckSession
    if (!stuck) return
    setStatus('Reopening that session…')
    void (async () => {
      const res = await fetch(`/api/session/${stuck.id}`)
      if (!res.ok) {
        // It ended between the 409 and this click (idle reap, or another tab).
        // Nothing to reopen and nothing stuck any more, so clear the banner and
        // leave Andre at Idle, where the primary action starts a fresh session.
        setStatus('That session is no longer open. Start a new one.')
        setSessionConflict(false)
        setStuckSession(null)
        return
      }
      const state = (await res.json()) as {
        entries: Entry[]
        awaitingRetry: boolean
        startedAt: string
        hintRung?: number
      } & Drill
      sessionIdRef.current = stuck.id
      setDrill({ track: state.track, problem: state.problem, budgetMs: state.budgetMs })
      // Resumed from the session's real start, not from now — reopening a timed
      // drill twenty minutes in must show twenty-five minutes left, not a fresh
      // forty-five. That is the whole difference between resuming and restarting.
      setDeadlineAt(state.budgetMs === undefined ? null : Date.parse(state.startedAt) + state.budgetMs)
      setEntries(state.entries)
      setInterviewerSpeaking(false)
      // Nothing is owed on a reopen: the question that was asked is already in
      // `state.entries`, so this is his move, not a wait.
      setAwaitingInterviewer(false)
      setInterimSentences([])
      setSessionConflict(false)
      setStuckSession(null)
      setTranscriptFailed(state.awaitingRetry)
      // Carried over for the same reason `awaitingRetry` is: a reopened drill
      // that reset the counter to zero would read as a cold attempt and would log
      // one, understating the help actually taken.
      setHintRung(state.hintRung ?? 0)
      connectStream(stuck.id)
      setMode('listening-to-interviewer')
      setStatus(state.awaitingRetry ? 'Reopened — that last answer still needs transcribing.' : 'Reopened. Your turn.')
      if (!mediaDevicesUnsupported()) void acquireStream()
    })()
  }, [stuckSession, connectStream, acquireStream])

  const forceEndStuckSession = useCallback(() => {
    setStatus('Ending the stuck session…')
    void (async () => {
      await fetch('/api/session', { method: 'DELETE' })
      setSessionConflict(false)
      setStuckSession(null)
      // "End it and start fresh" is one action in the handoff, not two — chain
      // straight into `start` rather than leaving Andre back at Idle needing
      // a second press.
      start()
    })()
  }, [start])

  // The dock's "End session" action. Reuses the same `POST /turn`-adjacent
  // endpoint the `beforeunload` handler below already fires via
  // `sendBeacon` (`/api/session/:id/end`) — the server's response is the
  // `ended` SSE event `connectStream` already listens for, which is what
  // actually flips `mode` to `'ended'` and releases the mic stream. No new
  // server surface needed for this.
  const endSession = useCallback(() => {
    const id = sessionIdRef.current
    if (!id) return
    // A coding drill's `/end` takes a model minute, and for all of it the button
    // is still on screen and `mode` is still not `'ended'`. A second press used
    // to send a second `/end` — which the server now refuses with a 409, but the
    // press should not produce a request at all: the status line below would
    // otherwise announce a close that this call is not the one performing.
    if (endingRef.current) return
    endingRef.current = true
    // A coding drill's `/end` drives one last interviewer turn — its closing
    // verdict — so this request takes as long as a model turn rather than
    // returning at once. Say so, or the button reads as having done nothing.
    setStatus('Closing out — the interviewer is giving its verdict…')
    void (async () => {
      let res: Response | null = null
      try {
        res = await fetch(`/api/session/${id}/end`, { method: 'POST' })
      } catch (error) {
        console.error('voice: POST /end failed', error)
      }
      switch (endOutcome(res === null ? null : res.status)) {
        case 'awaiting-server':
          // The `ended` SSE event moves the screen, not this response.
          return
        case 'already-saved':
          // The session is gone from the store, and `endAndPersist` removes it
          // only after writing the transcript — so the drill is over and saved,
          // and the event that would have said so is never coming. Reporting
          // that and staying put is what left "End session" explaining itself
          // politely forever. End here instead.
          setStatus('That session was already saved on the server. Ending here.')
          finishLocally()
          return
        case 'failed': {
          // This press ended nothing, so nothing moves and the button comes back.
          endingRef.current = false
          if (res === null) {
            setStatus('Could not reach the drill server to end the session. Try again.')
            return
          }
          const { error } = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string }
          setStatus(`Could not end the session: ${error}`)
        }
      }
    })()
  }, [finishLocally])

  const record = useCallback(() => {
    setElapsedSeconds(0)

    if (mediaDevicesUnsupported()) {
      setStatus(
        'Microphone access is unavailable: this page is not running in a secure context ' +
          '(Safari does not treat http://localhost as one). Try Chrome or Firefox, or serve this over HTTPS.',
      )
      return
    }

    void (async () => {
      // Reuse the stream acquired in `start`, unless it's gone bad (device
      // unplugged, track ended) — then fall back to a fresh request instead
      // of handing a dead stream to MediaRecorder. Most turns take this
      // branch and skip straight to recording with no prompt at all.
      let stream = mediaStreamRef.current
      if (!streamIsLive(stream)) {
        // Honest feedback for the case that DOES have to wait on the
        // browser: distinct from `'recording'` so the indicator/button never
        // claim a live mic before one exists. Getting this wrong — flipping
        // to `'recording'` before permission is granted — is the bug this
        // fix replaces.
        setMode('requesting-mic')
        setStatus('Requesting microphone access…')
        stream = await acquireStream()
        if (!stream) {
          setMode('listening-to-interviewer')
          return
        }
      }

      recordedChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data)
      }
      recorder.start()
      // Only now — after `MediaRecorder.start()` has actually been called —
      // does the UI claim to be recording.
      setMode('recording')
      setStatus('Recording. Press the button when you are done.')

      // Display only. This interval NEVER calls `recorder.stop()` — turn-
      // taking is an explicit button press, full stop. No voice-activity
      // detection, no auto-stop, no silence timer: "Let silence sit. Do not
      // fill it. Thinking time is the exercise." This readout exists only so
      // Andre can see he's running long against the ~2 minute target.
      const startedAt = Date.now()
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
      }, 1000)
    })()
  }, [acquireStream])

  const stopAndSubmit = useCallback(() => {
    clearElapsedTimer()
    void (async () => {
      const recorder = mediaRecorderRef.current
      if (!recorder) return
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.stop()
      await stopped
      // Deliberately NOT stopping `recorder.stream`'s tracks here — that
      // stream is cached in `mediaStreamRef` and reused for the next turn
      // (see `record`/`acquireStream`). Tracks are stopped only at session
      // end or unmount (`releaseMicStream`); stopping them per-turn is what
      // forced a fresh permission-adjacent `getUserMedia` call every turn.

      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType })
      // Before the upload, not after: this is what takes the primary control out
      // of "End answer" for the duration of the round trip.
      setMode('transcribing')
      setStatus('Transcribing…')
      const id = sessionIdRef.current
      if (!id) return
      const res = await fetch(`/api/session/${id}/turn`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
      })
      if (res.status === 422) {
        const { error } = (await res.json()) as { error: string }
        setStatus(`Turn failed: ${error}`)
        // The server (voice/http-server.ts) keeps the session alive and
        // retains the audio on a transcription failure — the question still
        // stands, so this parks in the same 'listening-to-interviewer'/ready
        // state a normal turn's success would, not 'ended'. The mic stream
        // stays held (see mediaStreamRef) so "Answer again" can re-record
        // without a fresh permission prompt.
        setMode('listening-to-interviewer')
        // No reply is coming — the turn failed, so the next move is his.
        setAwaitingInterviewer(false)
        setTranscriptFailed(true)
        return
      }
      setMode('listening-to-interviewer')
      setAwaitingInterviewer(true)
      // Clears a prior turn's transcription error: recording again is one of
      // the ways out of that state (the primary action stays live under the
      // banner), so a success here has resolved it just as "Answer again" would.
      setTranscriptFailed(false)
      setStatus('Your turn was received.')
    })()
  }, [clearElapsedTimer])

  // "Retry transcription": re-runs transcription on the audio the failed
  // turn already uploaded, server-side — no re-recording. On success, the
  // server proceeds exactly like a normal turn (commits the Andre entry,
  // streams the interviewer's reply) over the existing SSE connection, which
  // `connectStream`'s `entry`/`sentence` listeners already handle with no
  // change needed here. On failure, the session stays recoverable — same
  // error, updated message — rather than escalating.
  const retryTranscription = useCallback(() => {
    const id = sessionIdRef.current
    if (!id) return
    setStatus('Retrying transcription…')
    void (async () => {
      const res = await fetch(`/api/session/${id}/turn/retry`, { method: 'POST' })
      if (res.status === 422) {
        const { error } = (await res.json()) as { error: string }
        setStatus(`Retry failed: ${error}`)
        return
      }
      setTranscriptFailed(false)
      setStatus('Your turn was received.')
    })()
  }, [])

  // "Answer again" / "Skip this turn": both drop the retained audio
  // (`POST .../turn/abandon`) and clear the error, leaving the session ready
  // for the next recording — see the interface comment on `abandonTurn` for
  // why one server call covers both client actions.
  const abandonTurn = useCallback(() => {
    const id = sessionIdRef.current
    if (!id) return
    void (async () => {
      await fetch(`/api/session/${id}/turn/abandon`, { method: 'POST' })
      setTranscriptFailed(false)
      setStatus('Ready for your answer.')
    })()
  }, [])

  /**
   * "Run tests": runs the drill's suite and lets the interviewer react.
   *
   * `testsRunning` is a real guard, not just a label — a vitest run takes
   * seconds, and the server refuses a second one with a 409 while the first
   * interviewer turn is still in flight. Blocking here means the common case
   * never has to surface that 409 as an error.
   *
   * A failed *request* and a failed *suite* are deliberately different things:
   * a red suite is the drill working as intended and arrives as a verdict, so
   * only a transport or server error reaches `status`.
   */
  const runTests = useCallback(() => {
    const id = sessionIdRef.current
    if (!id || testsRunningRef.current) return
    testsRunningRef.current = true
    setTestsRunning(true)
    setStatus('Running the tests…')
    void (async () => {
      try {
        const res = await fetch(`/api/session/${id}/tests`, { method: 'POST' })
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string }
          setStatus(`Could not run the tests: ${error}`)
          return
        }
        // Either shape; which one is decided by the drill's track, and only the
        // screen needs to know that. See types.ts's AnyVerdict.
        setVerdict((await res.json()) as AnyVerdict)
        setStatus('Tests finished.')
      } catch (error) {
        setStatus('Could not reach the drill server to run the tests.')
        console.error('voice: POST /tests failed', error)
      } finally {
        testsRunningRef.current = false
        setTestsRunning(false)
      }
    })()
  }, [])

  /**
   * "Ask for a hint": one rung, delivered out loud.
   *
   * The response carries the rung the server settled on rather than this
   * incrementing a local counter — the server clamps at the last rung, and two
   * sources of truth for "how much help has he taken" is exactly how the number
   * `/status` depends on stops being trustworthy.
   */
  const askForHint = useCallback(() => {
    const id = sessionIdRef.current
    if (!id || hintPendingRef.current) return
    hintPendingRef.current = true
    setHintPending(true)
    void (async () => {
      try {
        const res = await fetch(`/api/session/${id}/hint`, { method: 'POST' })
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error: string }
          setStatus(`Could not ask for a hint: ${error}`)
          return
        }
        const { rung, servable } = (await res.json()) as { rung: number; servable?: boolean }
        setHintRung(rung)
        // `servable: false` means the ask bought nothing — the debugging ladder
        // runs out after rung 1, and the server refuses rather than letting the
        // interviewer guess at the defect. Kept separate from `hintRung`, which is
        // help actually taken and what the drill-log row records: a refusal must
        // not read as a hint in either place. Absent on a coding drill, where
        // every rung can be served.
        if (servable === false) setHintsExhausted(true)
      } catch (error) {
        setStatus('Could not reach the drill server to ask for a hint.')
        console.error('voice: POST /hint failed', error)
      } finally {
        hintPendingRef.current = false
        setHintPending(false)
      }
    })()
  }, [])

  // `''` from the <select>'s own "system default" option means "no explicit
  // choice" — normalized to `null` here so the rest of the hook only ever
  // deals in `string | null`.
  const selectInput = useCallback(
    (deviceId: string) => {
      const normalized = deviceId === '' ? null : deviceId
      selectedInputIdRef.current = normalized
      setSelectedInputId(normalized)
      if (normalized) persistDeviceConfig({ webInput: normalized })
      // The cached stream (see `mediaStreamRef`) is keyed to whatever device
      // it was opened against — reused as-is, it would keep recording from
      // the old microphone regardless of this selection. Releasing it here
      // and re-acquiring immediately (when a session is actually live) is
      // what makes the new choice take effect right away instead of on the
      // next `start()`.
      releaseMicStream()
      if (modeRef.current !== 'idle' && modeRef.current !== 'ended') void acquireStream()
    },
    [releaseMicStream, acquireStream],
  )

  const selectOutput = useCallback((id: string) => {
    const normalized = id === '' ? null : id
    setSelectedOutputId(normalized)
    // No local audio pipeline to restart — the server (`voice/http-server.ts`)
    // re-reads `local/voice.json` on every sentence it speaks, so persisting
    // here is the entire effect; the very next reply picks it up.
    persistDeviceConfig({ output: normalized ?? '' })
  }, [])

  // Devices can change while the app is open (a headset plugged in) —
  // `devicechange` is the browser's own signal for that. Also runs once on
  // mount: Chrome persists per-origin microphone permission across reloads,
  // so labels can already be available with no fresh gesture at all.
  useEffect(() => {
    if (mediaDevicesUnsupported()) return
    void refreshInputDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshInputDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshInputDevices)
  }, [refreshInputDevices])

  // Restores the persisted device selection (see `readDeviceConfig` /
  // `local/voice.json`, shared with `cli.ts` for the `output` field) and
  // loads the speaker list the server can see (`GET /api/devices/output`) —
  // the browser has no output-device enumeration API of its own, which is
  // exactly why speech happens server-side at all.
  useEffect(() => {
    void (async () => {
      const config = await fetchDeviceConfig()
      if (config?.webInput) {
        selectedInputIdRef.current = config.webInput
        setSelectedInputId(config.webInput)
      }
      if (config?.output) setSelectedOutputId(config.output)
    })()
    void (async () => {
      try {
        const res = await fetch('/api/devices/output')
        if (!res.ok) return
        const { devices } = (await res.json()) as { devices: OutputDevice[] }
        setOutputDevices(devices)
      } catch {
        // No speaker list is not fatal — the server still speaks through
        // whatever the system default output is.
      }
    })()
  }, [])

  useEffect(() => {
    const handler = (): void => {
      const id = sessionIdRef.current
      // `endingRef` as well as the mode: closing the tab *during* the closing
      // turn was the other half of the double-`/end` race, and `mode` does not
      // flip until the `ended` SSE event arrives at the end of that turn.
      if (id && modeRef.current !== 'ended' && !endingRef.current) {
        // Best-effort — the server's SSE-disconnect handler is the real
        // guarantee that an abandoned tab still gets persisted.
        navigator.sendBeacon(`/api/session/${id}/end`)
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  useEffect(() => clearElapsedTimer, [clearElapsedTimer])
  useEffect(() => releaseMicStream, [releaseMicStream])

  // One banner selector combining every real failure path this hook reaches.
  // Precedence matters where two could theoretically coexist: a stuck
  // session (refused at `start`) takes priority over a stale mic failure
  // from a previous attempt, and a fresh mic failure takes priority over
  // `micUnsupported`, which is a standing environmental fact rather than a
  // one-off rejection.
  const errorKind: ErrorKind | null = useMemo(() => {
    if (sessionConflict) return 'stuck'
    if (transcriptFailed) return 'transcript'
    if (micFailureKind) return micFailureKind
    if (micUnsupported && (mode === 'requesting-mic' || mode === 'recording')) return 'nodevice'
    return null
  }, [sessionConflict, transcriptFailed, micFailureKind, micUnsupported, mode])

  const dismissError = useCallback(() => {
    setSessionConflict(false)
    setTranscriptFailed(false)
    setMicFailureKind(null)
  }, [])

  return {
    mode,
    status,
    entries,
    elapsedSeconds,
    interviewerSpeaking,
    awaitingInterviewer,
    interimSentences,
    micUnsupported,
    sessionConflict,
    micFailureKind,
    transcriptFailed,
    errorKind,
    dismissError,
    drill,
    remainingSeconds,
    starting,
    stuckSession,
    reopenStuckSession,
    retryTranscription,
    abandonTurn,
    start,
    runTests,
    verdict,
    testsRunning,
    askForHint,
    hintRung,
    hintsExhausted,
    hintPending,
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
  }
}
