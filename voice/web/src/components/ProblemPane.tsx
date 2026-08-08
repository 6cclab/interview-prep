import { useEffect, useState } from 'react'

/**
 * The design track's problem statement, on screen for the whole drill.
 *
 * This is the reason the design track waited for a browser at all: in the
 * terminal the prompt scrolls away the moment the conversation starts, and a
 * 45-minute design interview where you cannot re-read the question is testing
 * the wrong thing. A real whiteboard interview leaves the prompt up.
 *
 * It renders `GET /api/problems/:problem`, which serves `README.md` alone —
 * never the rubric (the dimensions being scored) and never `reference.md` (a
 * worked design, and a spoiler the server refuses outright). See the route.
 *
 * Collapsible, because the transcript is the other thing competing for this
 * screen and a long prompt should not push it out of view for the whole drill.
 */

interface Props {
  problem: string
}

export function ProblemPane({ problem }: Props) {
  const [prompt, setPrompt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let live = true
    setPrompt(null)
    setFailed(false)
    void (async () => {
      try {
        const res = await fetch(`/api/problems/${encodeURIComponent(problem)}`)
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { prompt: string }
        if (live) setPrompt(body.prompt)
      } catch {
        // The interviewer still has the prompt and speaks it, so a failure here
        // costs the on-screen copy, not the drill. Say which it is.
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [problem])

  return (
    <section className="problem-pane" aria-label="Problem statement">
      <button
        type="button"
        className="problem-pane__summary"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="problem-pane__label">Problem</span>
        <span className="problem-pane__name">{problem}</span>
        <span className="problem-pane__toggle" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="problem-pane__body">
          {failed ? (
            <p className="problem-pane__note">
              The prompt could not be loaded on screen. The interviewer has it and will read it out — the drill is not
              affected.
            </p>
          ) : prompt === null ? (
            <p className="problem-pane__note">Loading the prompt…</p>
          ) : (
            // Rendered as preformatted text, not parsed as markdown: the prompt
            // is a committed file written for a human to read, and adding a
            // markdown renderer to display it would be a dependency bought for
            // nothing. Wrapped, so long lines do not scroll sideways.
            <pre className="problem-pane__prompt">{prompt}</pre>
          )}
        </div>
      )}
    </section>
  )
}
