import { useEffect, useRef, useState } from 'react'
import { Button } from 'brutalkit/button'
import { Bubble, BubbleContent } from 'brutalkit/bubble'
import { Message, MessageContent, MessageGroup, MessageHeader } from 'brutalkit/message'
import type { CostMeasurement, DebugVerdict, DrillVerdict } from '../types'
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

/** Seconds to `41.2s` / `410ms` — the unit the number is actually legible in. */
export function costLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
}

/**
 * How wide the two bars are, as percentages of the row.
 *
 * The budget bar is pinned short and the overrun is what grows, because the
 * comparison being drawn is "how far past" rather than "how long". Capped so a
 * 300x overrun does not render a bar three screens wide and lose the budget
 * reference entirely — past the cap the *number* carries the magnitude and the
 * bar just says "far".
 */
export function costWidths(measurement: CostMeasurement): { budget: number; actual: number } {
  // 4%, not the handoff's literal 13px. Its numbers were measured on a board of
  // one fixed width, and the ratio is what carries the meaning — 13px against
  // 268px is the 20.6x of its own worked example. Sized so that example, and a
  // real measured 8.3x (min-eating-speed's brute force: 41.4s against 5.00s),
  // both draw proportionally instead of pinning to the cap. A budget bar wide
  // enough to look substantial is a budget bar that caps at 7x.
  const BUDGET_PCT = 4
  const MAX_PCT = 100
  const ratio = measurement.actualMs / measurement.budgetMs
  return { budget: BUDGET_PCT, actual: Math.min(MAX_PCT, Math.max(BUDGET_PCT, BUDGET_PCT * ratio)) }
}

/**
 * The two-bar measurement, and the reason the third verdict exists.
 *
 * Both numbers are real: every cost fixture times itself and asserts
 * `expect(elapsed).toBeLessThan(budget)`, so a failure states the actual and the
 * ceiling. Neither is estimated. The bars are the clearest possible statement
 * that this is a *measurement* — a working answer, measured, and too expensive —
 * rather than a failure, which is the whole point the design makes about not
 * colouring this one red.
 */
function CostBars({ measurement }: { measurement: CostMeasurement }) {
  const width = costWidths(measurement)
  return (
    <div className="drill-cost">
      <div className="drill-cost-row">
        <span>Budget</span>
        <span className="drill-cost-bar" style={{ width: `${width.budget}%` }} />
        <time>{costLabel(measurement.budgetMs)}</time>
      </div>
      <div className="drill-cost-row">
        <span>Yours</span>
        <span className="drill-cost-bar" data-actual="" style={{ width: `${width.actual}%` }} />
        <time>{costLabel(measurement.actualMs)}</time>
      </div>
    </div>
  )
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
          <p>Correctness and cost. Expect to be asked for complexity.</p>
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
          {verdict.measurement !== undefined && <CostBars measurement={verdict.measurement} />}
          <pre>{verdict.failed.join('\n')}</pre>
          <footer>The answer stands · the cost does not</footer>
        </>
      )}
      {verdict.kind === 'errored' && (
        <>
          <p>The suite could not be run — usually a syntax or type error.</p>
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
          <p>The reported symptom is green, the invariant is not — the same defect is reachable by a second path.</p>
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
    ? 'The coach speaks out loud. Press once to talk, once when you are done. Nothing here is timed or scored.'
    : 'The interviewer asks out loud. Press once to answer, once when you are done.'
}

/**
 * One spoken turn, as the design system's `Message`.
 *
 * `align` is what makes a transcript read as a conversation rather than as a
 * log: the interviewer sits left, the candidate right. Both are kept — the
 * candidate's own words are half the record, and the thing scrolled back to
 * weeks later is usually what *they* said, not what they were asked.
 *
 * `data-live` stays on the outer `Message` and keeps doing what it did: the
 * most recent interviewer turn is `--foreground` at `--step-live` while
 * everything above it sits at `--muted-foreground`. That contrast is what makes
 * a wall of prose readable as a conversation with a current position in it, so
 * it survives the move to `Message` rather than being traded for it.
 */
function SpeechEntry({
  speaker,
  text,
  meta,
  partner,
  live,
  streaming = false,
}: {
  speaker: 'andre' | 'interviewer'
  text: string
  meta?: string
  partner: string
  live: boolean
  streaming?: boolean
}) {
  const them = speaker === 'interviewer'
  return (
    <Message align={them ? 'start' : 'end'} data-live={live ? '' : undefined} className="drill-message">
      <MessageContent>
        <MessageHeader>
          {them ? partner : 'You'}
          {meta ? ` · ${meta}` : ''}
        </MessageHeader>
        {/* Both variants are neutral, and that is a constraint rather than a
            missed opportunity. Colour on this screen is spoken for: red means
            the answer is wrong, ochre means it is right and too expensive, and
            those two readings are the ones `drill.md` is most insistent about
            not blurring. A tinted "your turn" bubble would put a third colour
            in the same column and spend it on which of two people was talking.
            Filled against outlined separates them without any. */}
        <Bubble variant={them ? 'muted' : 'outline'}>
          <BubbleContent>
            <TurnBody text={text} />
            {streaming && <span className="drill-caret" aria-hidden="true" />}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
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
        <div className="drill-stream-head workbench__label">
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

        <MessageGroup className="drill-messages">
        {stream.map((entry, i) =>
          entry.kind === 'speech' ? (
            <SpeechEntry
              key={`${entry.kind}-${entry.at}-${i}`}
              speaker={entry.speaker}
              text={entry.text}
              meta={meta[i] ?? ''}
              partner={partner}
              live={i === live}
            />
          ) : (
            // Not messages, and deliberately not rendered as any. A verdict is
            // a measurement the suite produced and a hint is a fact about the
            // round; neither was said by anyone, and giving them a speaker and
            // a side would be the screen claiming something happened that did
            // not. They keep the timestamped-gutter shape.
            <div className="drill-entry" key={`${entry.kind}-${entry.at}-${i}`} data-kind={entry.kind}>
              <time>{meta[i] ?? ''}</time>
              {entry.kind === 'verdict' && <DrillVerdictEntry verdict={entry.verdict} hintRung={hintRung} />}
              {entry.kind === 'debug-verdict' && <DebugVerdictEntry verdict={entry.verdict} />}
              {entry.kind === 'hint' && (
                <div className="drill-hint-entry">
                  <header className="workbench__label">
                    Rung {entry.rung} of 4 spent
                  </header>
                  <p>
                    The interviewer gave rung {entry.rung}. {4 - entry.rung}{' '}
                    {4 - entry.rung === 1 ? 'rung' : 'rungs'} left.
                  </p>
                </div>
              )}
            </div>
          ),
        )}

        {/* The in-progress reply. Rendered as a live entry rather than appended
            to the record, because it is not a turn until the server says so —
            the `entry` SSE event is what makes it one. */}
        {interimSentences.length > 0 && (
          <SpeechEntry speaker="interviewer" text={interimSentences.join(' ')} partner={partner} live streaming={streaming} />
        )}
        </MessageGroup>
      </div>

      {!pinned && (
        <Button type="button" variant="outline" size="sm" className="drill-back-to-live" onClick={backToLive}>
          <span />
          Back to live ↓
        </Button>
      )}
    </div>
  )
}
