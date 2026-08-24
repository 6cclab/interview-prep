import { useEffect, useRef, useState } from 'react'
import type { DebugVerdict, DrillVerdict } from '../types'
import { liveIndex, type StreamEntry } from '../stream'
import { Markdown } from './Markdown'

/**
 * The session stream: one append-only record of the round.
 *
 * Replaces both the transcript column and the verdict panel that used to sit
 * under the toolbar. That panel was an *insertion* — a failing suite pushed the
 * problem pane and the editor up the screen mid-drill, which is exactly when
 * nothing should move. Here a verdict is an entry like any other, appended at
 * the bottom of a scroll container, and the layout above it never learns it
 * happened.
 */

const PARTNER_FALLBACK = 'Interviewer'

/** How close to the bottom still counts as pinned. Carried over from the old transcript. */
const PIN_THRESHOLD_PX = 48

interface Props {
  stream: StreamEntry[]
  /** Sentences of the interviewer's in-progress reply, shown as a live entry with a caret. */
  interimSentences: string[]
  streaming: boolean
  /** `mm:ss` per entry, formatted by the caller — this component does not own the clock. */
  meta: string[]
  /** "Interviewer" on a drill, "Coach" when pairing: the pairing track's whole claim is that it is not an interview. */
  partner?: string
  /** Rungs spent, for the pass verdict's footer. Server-counted; see `passFooter`. */
  hintRung?: number
}

/**
 * A turn's body, rendered as markdown only when it actually contains a fence.
 *
 * Carried over unchanged from the old transcript, comment and all: only the
 * pairing coach emits code, every other track's prose is written to be *spoken*,
 * and running it through a renderer would let a stray asterisk restyle a
 * sentence never meant as markup.
 */
function TurnBody({ text }: { text: string }) {
  if (!text.includes('```')) return <p>{text}</p>
  return (
    <div>
      <Markdown source={text} />
    </div>
  )
}

/**
 * Which visual verdict a coding result gets.
 *
 * The mapping is the load-bearing part, and it is the reason `drill.md` cares:
 * `cost-red` is a *right answer that costs too much*, so it must not be red.
 * Red carries exactly one meaning on this screen — the answer is wrong.
 */
export function drillVerdictKind(verdict: DrillVerdict): string {
  if (verdict.kind === 'green') return 'pass'
  if (verdict.kind === 'correctness-red') return 'wrong'
  if (verdict.kind === 'cost-red') return 'over-budget'
  return 'errored'
}

/**
 * What a pass cost, as the pass's own footer.
 *
 * Written on the verdict rather than left to the toolbar counter, because this
 * entry is the thing scrolled back to weeks later — and `drill.md` is emphatic
 * that a solve that took four rungs is a different fact from a cold one. A
 * green with no price on it is exactly the flattening the drill log's preamble
 * warns about.
 */
export function passFooter(hintRung: number): string {
  if (hintRung === 0) return 'Cold · no help taken'
  return `Rung ${hintRung} of 4 · help taken`
}

function DrillVerdictEntry({ verdict, hintRung }: { verdict: DrillVerdict; hintRung: number }) {
  const kind = drillVerdictKind(verdict)
  return (
    <div className="drill-verdict" data-verdict={kind}>
      <header>
        <h4>{VERDICT_HEAD[kind]}</h4>
      </header>
      {verdict.kind === 'green' && (
        <>
          <p>Correctness and cost. Expect to be asked for the time and space complexity before this counts as done.</p>
          <footer>{passFooter(hintRung)}</footer>
        </>
      )}
      {verdict.kind === 'correctness-red' && (
        <>
          <p>
            {verdict.failed.length} correctness {verdict.failed.length === 1 ? 'test' : 'tests'} failed. The answer is
            not right yet.
          </p>
          <pre>{verdict.failed.join('\n')}</pre>
        </>
      )}
      {verdict.kind === 'cost-red' && (
        <>
          {/* Says what it is before it says what failed. The design is emphatic
              that this is a measurement rather than an alarm, and the sentence
              doing that work has to come before the list of red-looking names. */}
          <p>Correctness passed. The cost did not — this is a working answer that is too expensive.</p>
          <pre>{verdict.failed.join('\n')}</pre>
          <footer>The answer stands · the cost does not</footer>
        </>
      )}
      {verdict.kind === 'errored' && (
        <>
          <p>The suite could not be run — usually a syntax or type error in the solution.</p>
          <pre>{verdict.message}</pre>
        </>
      )}
    </div>
  )
}

/**
 * The debugging track's verdicts, which have their own taxonomy and their own
 * trap: two kinds of *green*, and the flattering one is the wrong one.
 *
 * `symptom-patch` therefore gets the ochre measurement treatment rather than the
 * success one — the reported symptom is green and the invariant is not, which is
 * a partial fix, and `debug.md` says to say so plainly rather than congratulate
 * it. It is not `wrong` either: nothing here is incorrect, it is incomplete.
 */
export function debugVerdictKind(verdict: DebugVerdict): string {
  if (verdict.kind === 'root-cause') return 'pass'
  if (verdict.kind === 'symptom-patch') return 'over-budget'
  if (verdict.kind === 'unfixed') return 'wrong'
  return 'errored'
}

function DebugVerdictEntry({ verdict }: { verdict: DebugVerdict }) {
  const kind = debugVerdictKind(verdict)
  return (
    <div className="drill-verdict" data-verdict={kind}>
      <header>
        <h4>{DEBUG_HEAD[verdict.kind]}</h4>
      </header>
      {verdict.kind === 'root-cause' && <p>Both suites pass. The reported symptom is gone and the invariant holds.</p>}
      {verdict.kind === 'symptom-patch' && (
        <>
          <p>
            The reported symptom is green and the invariant is not. That is a symptom patch: the same defect is still
            reachable by a second path.
          </p>
          <footer>Reported symptom fixed · root cause not</footer>
        </>
      )}
      {verdict.kind === 'unfixed' && <p>The reported symptom still reproduces.</p>}
      {verdict.kind === 'errored' && (
        <>
          <p>The suites could not be run.</p>
          <pre>{verdict.message}</pre>
        </>
      )}
    </div>
  )
}

const VERDICT_HEAD: Record<string, string> = {
  pass: 'Suite · all tests passed',
  wrong: 'Suite · answer is wrong',
  'over-budget': 'Suite · correct, over budget',
  errored: 'Suite · could not run',
}

const DEBUG_HEAD: Record<DebugVerdict['kind'], string> = {
  'root-cause': 'Suites · root cause fixed',
  'symptom-patch': 'Suites · symptom patch',
  unfixed: 'Suites · still reproduces',
  errored: 'Suites · could not run',
}

/**
 * Copy for a stream with nothing in it yet.
 *
 * Carried over from the transcript this replaced, wording intact. It is the
 * only thing on the screen that explains the press-to-talk contract, and the
 * pairing track says it differently on purpose: its whole claim is that it is
 * not an interview, so it says nothing is timed or scored.
 */
function emptyCopy(partner: string): string {
  return partner === 'Coach'
    ? 'The coach speaks out loud. You press once to start talking and once when you are finished. Nothing ends a turn but you, and nothing here is timed or scored.'
    : 'The interviewer asks out loud. You press once to start answering and once when you are finished. Nothing ends a turn but you.'
}

export function SessionStream({
  stream,
  interimSentences,
  streaming,
  meta,
  partner = PARTNER_FALLBACK,
  hintRung = 0,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const live = liveIndex(stream)
  const empty = stream.length === 0 && interimSentences.length === 0
  /**
   * How many entries arrived while scrolled back.
   *
   * Captured at the moment of unpinning rather than counted continuously: the
   * question the head answers is "what have I missed", and that is relative to
   * where you were when you stopped following, not to the bottom of the list.
   */
  const [markedAt, setMarkedAt] = useState<number | null>(null)
  const behindBy = markedAt === null ? 0 : Math.max(0, stream.length - markedAt)

  // Reading back mid-round is legitimate, so falling behind is not an error
  // state — it dims the stream and offers a way back, and nothing auto-scrolls
  // underneath someone who is deliberately looking at an earlier turn.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || !pinned) return
    el.scrollTop = el.scrollHeight
  }, [stream, interimSentences, pinned])

  const onScroll = () => {
    const el = scrollRef.current
    if (el === null) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nowPinned = distance <= PIN_THRESHOLD_PX
    setPinned((was) => {
      // Mark the high-water line on the transition out of pinned, and clear it
      // on the way back — so re-reading twice does not accumulate a stale count.
      if (was && !nowPinned) setMarkedAt(stream.length)
      if (!was && nowPinned) setMarkedAt(null)
      return nowPinned
    })
  }

  const backToLive = () => {
    const el = scrollRef.current
    if (el === null) return
    setPinned(true)
    setMarkedAt(null)
    el.scrollTop = el.scrollHeight
  }

  return (
    <div className="drill-stream-wrap">
      {/* Only while scrolled back. Reading an earlier turn mid-round is
          legitimate, so this states where you are rather than warning you —
          and it is inside the wrap, above the scroller, so appearing costs the
          stream height rather than moving the editor above it. */}
      {!pinned && (
        <div className="drill-stream-head drill-label">
          Scrolled up{behindBy > 0 && ` · ${behindBy} newer ${behindBy === 1 ? 'entry' : 'entries'}`}
        </div>
      )}
      <div
        className="drill-stream"
        ref={scrollRef}
        onScroll={onScroll}
        data-behind={pinned ? undefined : ''}
        aria-label="Session record"
      >
        {/* Inside the scroll container rather than replacing it, so the first
            turn arriving does not swap one box for another — it appends, and
            the empty state simply stops being rendered. */}
        {empty && (
          <div className="drill-stream-empty">
            <h1>Nothing started yet.</h1>
            <p>{emptyCopy(partner)}</p>
          </div>
        )}

        {stream.map((entry, i) => (
          <div
            className="drill-entry"
            key={`${entry.kind}-${entry.at}-${i}`}
            data-kind={entry.kind}
            data-live={i === live ? '' : undefined}
          >
            <time>{meta[i] ?? ''}</time>
            {entry.kind === 'speech' && <TurnBody text={entry.text} />}
            {entry.kind === 'verdict' && <DrillVerdictEntry verdict={entry.verdict} hintRung={hintRung} />}
            {entry.kind === 'debug-verdict' && <DebugVerdictEntry verdict={entry.verdict} />}
            {entry.kind === 'hint' && (
              <div className="drill-hint-entry">
                <header className="drill-label">
                  Rung {entry.rung} of 4 spent
                </header>
                <p>
                  The interviewer gave rung {entry.rung}. {4 - entry.rung}{' '}
                  {4 - entry.rung === 1 ? 'rung' : 'rungs'} left.
                </p>
              </div>
            )}
          </div>
        ))}

        {/* The in-progress reply. Rendered as a live entry rather than appended
            to the record, because it is not a turn until the server says so —
            the `entry` SSE event is what makes it one. */}
        {interimSentences.length > 0 && (
          <div className="drill-entry" data-live="" data-kind="speech">
            <time>{partner}</time>
            <p>
              {interimSentences.join(' ')}
              {streaming && <span className="drill-caret" aria-hidden="true" />}
            </p>
          </div>
        )}
      </div>

      {!pinned && (
        <button type="button" className="drill-back-to-live" onClick={backToLive}>
          <span />
          Back to live ↓
        </button>
      )}
    </div>
  )
}
