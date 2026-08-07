import { useEffect, useRef, useState } from 'react'
import type { Entry } from '../types'

interface Props {
  entries: Entry[]
  /** The interviewer's reply-in-progress, joined sentence by sentence. See useVoiceSession.ts. */
  interimText: string
}

// How close to the bottom (px) still counts as "at the bottom" for the
// purposes of auto-scrolling. Generous enough to absorb sub-pixel rounding
// and the last turn's own height without feeling sticky.
const STICK_THRESHOLD_PX = 48

// Renders only the `speaker`/`text`/`at` fields of an `Entry`, sourced only
// from the `entry` SSE event (see useVoiceSession.ts's `entry` listener) or,
// for the in-progress reply, the same `sentence` payload the server already
// streams. Never the assembled system prompt, never `interviewer.lastRaw()`.
// This is the client half of the spoiler gate; the server half is enforced
// by voice/spoiler-gate.test.ts.
export function Transcript({ entries, interimText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stuckToBottom, setStuckToBottom] = useState(true)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStuckToBottom(distanceFromBottom < STICK_THRESHOLD_PX)
  }

  // Sticks to the bottom as new turns/sentences arrive — but only while the
  // reader was already at the bottom. Reviewing an earlier turn mid-session
  // (thirty turns in, scrolled up) must not get yanked back down by the next
  // sentence streaming in.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stuckToBottom) return
    el.scrollTop = el.scrollHeight
  }, [entries, interimText, stuckToBottom])

  const jumpToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setStuckToBottom(true)
  }

  const empty = entries.length === 0 && !interimText

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={scrollRef} onScroll={handleScroll} role="log" aria-label="Interview transcript">
        {empty && <p className="transcript__empty">The conversation will appear here once the interviewer begins.</p>}
        {entries.map((entry, i) => (
          <div className={`turn turn--${entry.speaker}`} key={i}>
            <span className="turn__speaker">{entry.speaker === 'andre' ? 'You' : 'Interviewer'}</span>
            <p className="turn__text">{entry.text}</p>
          </div>
        ))}
        {interimText && (
          <div className="turn turn--interviewer turn--live">
            <span className="turn__speaker">Interviewer</span>
            <p className="turn__text">
              {interimText}
              <span className="turn__cursor" aria-hidden="true" />
            </p>
          </div>
        )}
      </div>
      {!stuckToBottom && (
        <button type="button" className="jump-button" onClick={jumpToBottom}>
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}
