import { useEffect, useState } from 'react'
import type { ProblemTrack } from '../types'
import { Markdown } from './Markdown'

/**
 * A timed track's problem statement, on screen for the whole drill.
 *
 * This is the reason both these tracks waited for a browser at all: in the
 * terminal the prompt scrolls away the moment the conversation starts, and an
 * interview where you cannot re-read the question is testing the wrong thing. A
 * real whiteboard or screen-share interview leaves the prompt up.
 *
 * It renders `GET /api/problems/:problem?track=`, which serves `README.md` alone
 * — for design, never the rubric (the dimensions being scored) and never
 * `reference.md` (a worked design the server refuses outright); for coding,
 * never anything that names the pattern, including the path the file was read
 * from. See the route.
 *
 * Collapsible, because the transcript is the other thing competing for this
 * screen and a long prompt should not push it out of view for the whole drill.
 */

interface Props {
  problem: string
  track: ProblemTrack
}

export function ProblemPane({ problem, track }: Props) {
  const [prompt, setPrompt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(true)
  // Set from the response, never from a prop: whether the statement is being
  // withheld is the server's call, and the pane finds out the same way it finds
  // out anything else. See the `vague` branch of the problem route.
  const [withheld, setWithheld] = useState(false)

  useEffect(() => {
    let live = true
    setPrompt(null)
    setFailed(false)
    setWithheld(false)
    void (async () => {
      try {
        const res = await fetch(`/api/problems/${encodeURIComponent(problem)}?track=${track}`)
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { prompt: string; vague?: boolean }
        if (!live) return
        setPrompt(body.prompt)
        setWithheld(body.vague === true)
      } catch {
        // The interviewer still has the prompt and speaks it, so a failure here
        // costs the on-screen copy, not the drill. Say which it is.
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [problem, track])

  /**
   * Fetch the real statement, on request.
   *
   * A second round trip rather than something quietly held in state, because
   * the first response genuinely did not contain it. There is no confirmation
   * step: this is meant to be available, not defended. What it costs is that
   * taking it is a visible, deliberate act — the same bargain the hint button
   * makes.
   */
  async function reveal(): Promise<void> {
    try {
      const res = await fetch(`/api/problems/${encodeURIComponent(problem)}?track=${track}&reveal=1`)
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { prompt: string }
      setPrompt(body.prompt)
      setWithheld(false)
    } catch {
      setFailed(true)
    }
  }

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
            // Rendered markdown, not raw source. It was `<pre>` first, on the
            // reasoning that a renderer would be a dependency bought for nothing
            // — but the dependency turned out to be unnecessary (see
            // `markdown.ts`) and the raw `#`, `**` and fence lines were exactly
            // what someone stares at for forty-five minutes.
            <>
              <Markdown source={prompt} />
              {/* Clarify-first: what is on screen is the standing brief, not the
                  problem. The button is plain and unguarded on purpose — the mode
                  is teaching an opening, not withholding for its own sake, and a
                  confirm dialog would turn a legitimate move into a transgression. */}
              {withheld && (
                <button type="button" className="problem-pane__reveal" onClick={() => void reveal()}>
                  Reveal the written statement
                </button>
              )}
              {/* The shape of the harness, which is not the answer to anything and
                  cost a real drill ten minutes: a debugging exercise has no running
                  application in it. Nothing in `src/` calls the render functions —
                  the two test files are the only entry points — so "where is this
                  called from?" has no answer inside the source, and the interviewer
                  (which has seen neither) refused the question as though it did. */}
              {track === 'debug' && (
                <p className="problem-pane__note">
                  There is no running application here: the source is a set of modules, and{' '}
                  <code>repro.test.ts</code> and <code>invariant.test.ts</code> are the only things that call them.
                  Nothing in <code>src/</code> invokes them, so there is no call site to find.
                </p>
              )}
              {/* The second thing a real drill lost time to, after the missing call
                  site: an id from the bug report that is not in the fixture. The
                  report describes accounts as though a whole system existed behind
                  them; the harness is whatever `src/` hardcodes. Absence is a state
                  the code has to handle, so it is usually a condition under test —
                  which is a fact about how to read the exercise, not a hint about
                  the defect. */}
              {track === 'debug' && (
                <p className="problem-pane__note">
                  The fixtures in <code>src/</code> are the whole world. If the report names an account or an id that is
                  not in them, that absence is a state the code is being asked to handle — not a missing file. The
                  report is written the way a real one would be, by someone describing a system they cannot see.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
