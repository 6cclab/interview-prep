import { useCallback, useEffect } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { RecordingIndicator } from './components/RecordingIndicator'
import { ElapsedReadout } from './components/ElapsedReadout'
import { ErrorBanner } from './components/ErrorBanner'
import { Transcript } from './components/Transcript'
import type { Mode } from './types'

const MIC_UNSUPPORTED_MESSAGE =
  'Microphone access is unavailable on this page: it is not running in a secure context ' +
  '(Safari treats http://localhost this way). Try Chrome or Firefox, or serve this over HTTPS.'

function primaryLabel(mode: Mode): string {
  switch (mode) {
    case 'listening-to-interviewer':
      return 'Record your answer'
    case 'requesting-mic':
      return 'Requesting microphone…'
    case 'recording':
      return 'Done — send turn'
    case 'idle':
    case 'ended':
    default:
      return 'Start session'
  }
}

// Status strings the hook sets on a genuine failure — these get promoted
// from the quiet inline status line to the loud, actionable error banner.
// Matched by prefix rather than an explicit error flag because the state
// machine (useVoiceSession.ts) is settled/tested as a plain string status;
// this is presentation-only classification layered on top of it.
function isFailureStatus(status: string): boolean {
  return (
    status.startsWith('Microphone access failed') ||
    status.startsWith('Turn failed') ||
    status.startsWith('Session ended early')
  )
}

export default function App() {
  const {
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
  } = useVoiceSession()

  const onPrimaryAction = useCallback((): void => {
    if (mode === 'idle' || mode === 'ended') start()
    else if (mode === 'listening-to-interviewer') record()
    else if (mode === 'recording') stopAndSubmit()
  }, [mode, start, record, stopAndSubmit])

  // A keyboard shortcut for the primary action: he's talking, not aiming a
  // mouse. Space is the push-to-talk convention. Skipped when focus is
  // already on an interactive element (that element's own key handling
  // applies — e.g. the button's native Space-triggers-click — and the app
  // has no text inputs for Space to type into, so this never has to worry
  // about stealing space from a field).
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

  const errorMessage = micUnsupported
    ? MIC_UNSUPPORTED_MESSAGE
    : sessionConflict
      ? 'A session is already in progress and this tab lost track of it.'
      : isFailureStatus(status)
        ? status
        : null

  return (
    <>
      {/* A second, redundant signal for the recording state, deliberately
          outside the reading column: a full-width bar is easier to catch in
          peripheral vision, or from across a room, than any element sized to
          be read up close. */}
      <div className={`accent-bar${mode === 'recording' ? ' accent-bar--recording' : ''}`} aria-hidden="true" />

      <main>
        <header className="app-header">
          <h1>Voice mock drill</h1>
          <p className="app-header__subtitle">Behavioral practice, spoken</p>
        </header>

        {errorMessage && (
          <ErrorBanner
            message={errorMessage}
            action={sessionConflict ? { label: 'End the stuck session', onClick: forceEndStuckSession } : undefined}
          />
        )}

        <section className="stage" aria-label="Session state">
          <RecordingIndicator mode={mode} interviewerSpeaking={interviewerSpeaking} />
          <p id="status" className="status-text" aria-live="polite">
            {status}
          </p>
          {mode === 'recording' && <ElapsedReadout seconds={elapsedSeconds} />}
        </section>

        <div className="controls">
          <button
            type="button"
            className="primary-button"
            data-mode={mode}
            disabled={mode === 'requesting-mic'}
            onClick={onPrimaryAction}
          >
            {primaryLabel(mode)}
            <kbd className="primary-button__hint" aria-hidden="true">
              Space
            </kbd>
          </button>
        </div>

        <Transcript entries={entries} interimText={interviewerSpeaking ? interimInterviewerText : ''} />
      </main>
    </>
  )
}
