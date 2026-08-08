import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, ErrorKind, Mode } from './types'

export interface VoiceSession {
  mode: Mode
  status: string
  entries: Entry[]
  /** Seconds since the current recording started. Display only — see `record`. */
  elapsedSeconds: number
  /** True while the interviewer's reply is actively streaming in as sentences. Display only. */
  interviewerSpeaking: boolean
  /**
   * Sentences of the interviewer's in-progress reply, joined so far. Cleared
   * the moment the matching `entry` event lands with the full, final text —
   * this exists purely so the transcript can show the reply arriving
   * progressively rather than popping in all at once. Never a source of
   * truth: `entries` (built only from `entry` events) is.
   */
  interimInterviewerText: string
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
   * True after a 422 from `POST /turn`. The server (`voice/http-server.ts`,
   * off-limits to modify here) unconditionally ends and persists the session
   * on a transcription failure — so unlike the handoff's "parks in Ready"
   * description, this always lands in `mode === 'ended'`. See the deviation
   * note in the design report.
   */
  transcriptFailed: boolean
  /** One computed banner selector for the presentation layer — see `ErrorKind`. */
  errorKind: ErrorKind | null
  /** Dismisses the currently-showing error banner without changing `mode`. */
  dismissError(): void
  start(): void
  record(): void
  stopAndSubmit(): void
  /**
   * Recovery path for `sessionConflict`: force-ends whatever session is
   * stuck, then immediately starts a fresh one — this is what makes the
   * "stuck" banner's "End it and start fresh" action do what it says.
   */
  forceEndStuckSession(): void
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
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
  const [interimInterviewerText, setInterimInterviewerText] = useState('')
  const [sessionConflict, setSessionConflict] = useState(false)
  const [micUnsupported] = useState(mediaDevicesUnsupported)
  const [micFailureKind, setMicFailureKind] = useState<'denied' | 'nodevice' | null>(null)
  const [transcriptFailed, setTranscriptFailed] = useState(false)

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
  const acquireStream = useCallback(async (): Promise<MediaStream | null> => {
    if (mediaDevicesUnsupported()) return null

    setMicFailureKind(null)
    const watchdog = setTimeout(() => setStatus(MIC_WATCHDOG_MESSAGE), MIC_WATCHDOG_MS)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      clearTimeout(watchdog)
      mediaStreamRef.current = stream
      return stream
    } catch (error) {
      clearTimeout(watchdog)
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Microphone access failed: ${message}. You can still hear the interviewer; press the button to try again when you answer.`)
      setMicFailureKind(classifyMicError(error))
      return null
    }
  }, [])

  const connectStream = useCallback((id: string) => {
    eventSourceRef.current?.close()
    const es = new EventSource(`/api/session/${id}/stream`)
    eventSourceRef.current = es

    es.addEventListener('sentence', (event) => {
      const { text } = JSON.parse((event as MessageEvent<string>).data) as { text: string }
      setStatus('Interviewer speaking…')
      setInterviewerSpeaking(true)
      // Accumulates for the *current* reply only — cleared below the moment
      // the matching `entry` lands. Display only, same spoiler boundary as
      // `entries`: this text originates from the same `sentence` payload the
      // server already sends, nothing new is exposed.
      setInterimInterviewerText((prev) => (prev ? `${prev} ${text}` : text))
      void speak(text)
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
      setInterimInterviewerText('')
    })

    es.addEventListener('ended', (event) => {
      const { endedEarly } = JSON.parse((event as MessageEvent<string>).data) as { endedEarly: string | null }
      setStatus(endedEarly ? `Session ended early: ${endedEarly}` : 'Session ended.')
      setInterviewerSpeaking(false)
      setInterimInterviewerText('')
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
      setInterimInterviewerText('')
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
        // The server (voice/http-server.ts) unconditionally ends and persists
        // the session on a transcription failure, so there is no live
        // session left to return the question to — `mode` must follow it to
        // 'ended' rather than the handoff's 'ready'. See the design report.
        setMode('ended')
        setTranscriptFailed(true)
        releaseMicStream()
        return
      }
      setMode('listening-to-interviewer')
      setStatus('Your turn was received.')
    })()
  }, [clearElapsedTimer, releaseMicStream])

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
    interimInterviewerText,
    micUnsupported,
    sessionConflict,
    micFailureKind,
    transcriptFailed,
    errorKind,
    dismissError,
    start,
    record,
    stopAndSubmit,
    forceEndStuckSession,
  }
}
