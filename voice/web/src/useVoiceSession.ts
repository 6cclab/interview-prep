import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry, Mode } from './types'

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
  start(): void
  record(): void
  stopAndSubmit(): void
  /** Recovery path for `sessionConflict`: force-ends whatever session is stuck. */
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

export function useVoiceSession(): VoiceSession {
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('Idle.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false)
  const [interimInterviewerText, setInterimInterviewerText] = useState('')
  const [sessionConflict, setSessionConflict] = useState(false)
  const [micUnsupported] = useState(mediaDevicesUnsupported)

  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
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
    })
  }, [])

  const start = useCallback(() => {
    setSessionConflict(false)
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
    })()
  }, [connectStream])

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
      setStatus('Idle. The stuck session was ended — try starting again.')
    })()
  }, [])

  const record = useCallback(() => {
    // Feedback the instant the button is pressed: getUserMedia can hang on a
    // slow permission prompt, or reject outright, and with no state change
    // here the page looks dead for however long that takes.
    setMode('recording')
    setElapsedSeconds(0)

    if (mediaDevicesUnsupported()) {
      setStatus(
        'Microphone access is unavailable: this page is not running in a secure context ' +
          '(Safari does not treat http://localhost as one). Try Chrome or Firefox, or serve this over HTTPS.',
      )
      setMode('listening-to-interviewer')
      return
    }

    setStatus('Requesting microphone access…')

    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus(`Microphone access failed: ${message}. Click to try again.`)
        setMode('listening-to-interviewer')
        return
      }

      recordedChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data)
      }
      recorder.start()
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
  }, [])

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
      for (const track of recorder.stream.getTracks()) track.stop()

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
        setMode('ended')
        return
      }
      setMode('listening-to-interviewer')
      setStatus('Your turn was received.')
    })()
  }, [clearElapsedTimer])

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

  return {
    mode,
    status,
    entries,
    elapsedSeconds,
    interviewerSpeaking,
    interimInterviewerText,
    micUnsupported,
    sessionConflict,
    start,
    record,
    stopAndSubmit,
    forceEndStuckSession,
  }
}
