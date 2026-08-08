// The loudest state in the app, legible from across the room and in
// peripheral vision: a full-viewport frame plus a top-center pill. Both are
// `aria-hidden` — the live mic is announced through the polite live region
// and the dock's status text, not through this decoration. No waveform, no
// level meter: this says the app IS recording, never that it's listening
// FOR something.
export function RecordingChrome() {
  return (
    <>
      <div className="recording-frame" aria-hidden="true" />
      <div className="recording-pill" aria-hidden="true">
        <span className="recording-pill__dot" />
        Recording
      </div>
    </>
  )
}
