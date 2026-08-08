import { useEffect, useRef, useState } from 'react'
import type { Entry } from '../types'

interface Props {
  entries: Entry[]
  /** Sentences of the interviewer's in-progress reply — see useVoiceSession.ts's `interimSentences`. */
  interimSentences: string[]
  /** True while the interviewer's reply is actively streaming (drives the blinking caret). */
  streaming: boolean
  /** `entries[i]`'s rendered metadata — "N:NN spoken" for candidate turns, wall-clock for interviewer turns. See App.tsx. */
  meta: string[]
}

// How close to the bottom (px) still counts as "pinned" — matches the
// handoff's 48px.
const PIN_THRESHOLD_PX = 48
// Long critiques on turns that are not the newest collapse past this many
// words, per the handoff.
const COLLAPSE_WORD_THRESHOLD = 90

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// Renders only the `speaker`/`text`/`at` fields of an `Entry`, sourced only
// from the `entry` SSE event (see useVoiceSession.ts's `entry` listener), or
// for the in-progress reply, the same `sentence` payload the server already
// streams. Never the assembled system prompt, never `interviewer.lastRaw()`,
// which carries an unstripped story-log trailer. This is the client half of
// the spoiler gate; the server half is enforced by voice/spoiler-gate.test.ts.
export function Transcript({ entries, interimSentences, streaming, meta }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const mountedRef = useRef(false)
  const prevCountRef = useRef(0)

  const totalTurnsNow = entries.length + (interimSentences.length > 0 ? 1 : 0)

  // Jumps to the bottom on mount with no animated scroll (handoff: "On mount
  // the container jumps to the bottom"), then auto-follows on new content
  // only while pinned. Scrolling up unpins immediately elsewhere
  // (`handleScroll`) — content never yanks the view out from under a reader
  // who scrolled up mid-session.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!mountedRef.current) {
      mountedRef.current = true
      const behavior = el.style.scrollBehavior
      el.style.scrollBehavior = 'auto'
      el.scrollTop = el.scrollHeight
      el.style.scrollBehavior = behavior
      prevCountRef.current = totalTurnsNow
      return
    }
    if (totalTurnsNow > prevCountRef.current) {
      if (pinned) {
        el.scrollTop = el.scrollHeight
        setUnseen(0)
      } else {
        setUnseen((n) => n + (totalTurnsNow - prevCountRef.current))
      }
    }
    prevCountRef.current = totalTurnsNow
  }, [totalTurnsNow, pinned, entries, interimSentences])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX
    if (atBottom !== pinned) {
      setPinned(atBottom)
      if (atBottom) setUnseen(0)
    }
  }

  const jumpToLive = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setPinned(true)
    setUnseen(0)
  }

  const isEmpty = entries.length === 0 && interimSentences.length === 0

  // "Newest interviewer turn" means the most recent entry with
  // `speaker === 'interviewer'`, not merely the last entry overall — a
  // candidate turn can land after it (the user has answered, but the next
  // interviewer reply hasn't started streaming yet) without that question
  // becoming eligible to collapse.
  let newestInterviewerIndex = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.speaker === 'interviewer') {
      newestInterviewerIndex = i
      break
    }
  }
  // A live streaming turn (interimSentences non-empty) is always the newest
  // interviewer turn, so once one exists, no *earlier* entry qualifies.
  if (interimSentences.length > 0) newestInterviewerIndex = -1

  return (
    <div className="transcript-region">
      {isEmpty && (
        <div className="transcript-empty">
          <h1>Nothing started yet.</h1>
          <p>
            The interviewer asks out loud. You press once to start answering and once when you are finished. Nothing
            ends a turn but you.
          </p>
        </div>
      )}

      <div className="transcript" ref={scrollRef} onScroll={handleScroll} role="log" aria-label="Interview transcript">
        {entries.map((entry, i) => {
          const isNewest = i === newestInterviewerIndex
          if (entry.speaker === 'interviewer') {
            const words = wordCount(entry.text)
            const collapsible = !isNewest && words > COLLAPSE_WORD_THRESHOLD && !expanded.has(i)
            return (
              <div className="turn turn--interviewer" key={i}>
                <div className="turn__head">
                  <span className="turn__label">Interviewer</span>
                  <span className="turn__meta">{meta[i]}</span>
                </div>
                {collapsible ? (
                  <div>
                    <div className="turn__body turn__body--collapsed">{entry.text}</div>
                    <button
                      type="button"
                      className="turn__expand"
                      onClick={() => setExpanded((prev) => new Set(prev).add(i))}
                    >
                      Show full critique — {words} words
                    </button>
                  </div>
                ) : (
                  <div className="turn__body">{entry.text}</div>
                )}
              </div>
            )
          }
          return (
            <div className="turn turn--candidate" key={i}>
              <div className="turn__head">
                <span className="turn__label turn__label--muted">You</span>
                <span className="turn__meta">{meta[i]}</span>
              </div>
              <div className="turn__body turn__body--candidate">{entry.text}</div>
            </div>
          )
        })}

        {interimSentences.length > 0 && (
          <div className="turn turn--interviewer" key="live">
            <div className="turn__head">
              <span className="turn__label">Interviewer</span>
              <span className="turn__meta" />
            </div>
            <div className="turn__body">
              {interimSentences.map((sentence, i) => (
                <span className="turn__sentence" key={i}>
                  {sentence}{' '}
                </span>
              ))}
              {streaming && <span className="turn__caret" aria-hidden="true" />}
            </div>
          </div>
        )}
      </div>

      {!pinned && entries.length + interimSentences.length > 0 && (
        <button type="button" className="jump-pill" onClick={jumpToLive}>
          {unseen > 0 ? `Jump to live — ${unseen} new ↓` : 'Back to live ↓'}
        </button>
      )}
    </div>
  )
}
