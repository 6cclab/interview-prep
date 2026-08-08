import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, ErrorKind, MicDevice, Mode, OutputDevice } from './types'

export interface VoiceSession {
  mode: Mode
  status: string
  entries: Entry[]
  /** Seconds since the current recording started. Display only — see `record`. */
  elapsedSeconds: number
  /** True while the interviewer's reply is actively streaming in as sentences. Display only. */
  interviewerSpeaking: boolean
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
  start(): void
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

export function useVoiceSession(): VoiceSession {
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('Idle.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false)
  const [interimSentences, setInterimSentences] = useState<string[]>([])
  const [sessionConflict, setSessionConflict] = useState(false)
  const [micUnsupported] = useState(mediaDevicesUnsupported)
  const [micFailureKind, setMicFailureKind] = useState<'denied' | 'nodevice' | null>(null)
  const [transcriptFailed, setTranscriptFailed] = useState(false)
  const [inputDevices, setInputDevices] = useState<MicDevice[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null)
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([])
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)

  const sessionIdRef = useRef<string | null>(null)
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

    es.addEventListener('sentence', (event) => {
      const { text } = JSON.parse((event as MessageEvent<string>).data) as { text: string }
      setStatus('Interviewer speaking…')
      setInterviewerSpeaking(true)
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
      setInterviewerSpeaking(false)
      setInterimSentences([])
      es.close()
      setMode('ended')
      releaseMicStream()
    })
  }, [releaseMicStream])

  const start = useCallback(() => {
    setSessionConflict(false)
    setMicFailureKind(null)
    setTranscriptFailed(false)
    setStatus('Starting session…')
    void (async () => {
      const res = await fetch('/api/session', { method: 'POST' })
      if (res.status === 409) {
        setStatus('A session is already in progress.')
        setSessionConflict(true)
        return
      }
      const { id } = (await res.json()) as { id: string }
      sessionIdRef.current = id
      setEntries([])
      setInterviewerSpeaking(false)
      setInterimSentences([])
      connectStream(id)
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
  const forceEndStuckSession = useCallback(() => {
    setStatus('Ending the stuck session…')
    void (async () => {
      await fetch('/api/session', { method: 'DELETE' })
      setSessionConflict(false)
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
    void fetch(`/api/session/${id}/end`, { method: 'POST' })
  }, [])

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
        setTranscriptFailed(true)
        return
      }
      setMode('listening-to-interviewer')
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
      if (id && modeRef.current !== 'ended') {
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
    interimSentences,
    micUnsupported,
    sessionConflict,
    micFailureKind,
    transcriptFailed,
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
  }
}
