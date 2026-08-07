import { useVoiceSession } from './useVoiceSession'
import type { Mode } from './types'

function buttonLabel(mode: Mode): string {
  switch (mode) {
    case 'listening-to-interviewer':
      return 'Record your answer'
    case 'recording':
      return 'Done — send turn'
    case 'idle':
    case 'ended':
    default:
      return 'Start session'
  }
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const {
    mode,
    status,
    entries,
    elapsedSeconds,
    micUnsupported,
    sessionConflict,
    start,
    record,
    stopAndSubmit,
    forceEndStuckSession,
  } = useVoiceSession()

  const onButtonClick = (): void => {
    if (mode === 'idle' || mode === 'ended') start()
    else if (mode === 'listening-to-interviewer') record()
    else if (mode === 'recording') stopAndSubmit()
  }

  return (
    <main>
      <h1>Voice mock drill</h1>

      {micUnsupported && (
        <p role="alert" className="warning">
          Microphone access is unavailable on this page: it is not running in a secure context
          (Safari treats <code>http://localhost</code> this way). Try Chrome or Firefox, or serve
          this over HTTPS.
        </p>
      )}

      <p id="status">{status}</p>

      {mode === 'recording' && <p id="elapsed">Elapsed: {formatElapsed(elapsedSeconds)}</p>}

      <button type="button" onClick={onButtonClick}>
        {buttonLabel(mode)}
      </button>

      {sessionConflict && (
        <button type="button" onClick={forceEndStuckSession}>
          End the stuck session
        </button>
      )}

      <ol id="transcript">
        {entries.map((entry, i) => (
          <li key={i}>
            {entry.speaker === 'andre' ? 'You' : 'Interviewer'}: {entry.text}
          </li>
        ))}
      </ol>
    </main>
  )
}
