import { useState } from 'react'
import { useEffect } from 'react'
import { Button } from 'brutalkit/button'
import type { DrillResult, HistoryPayload, HistoryRow } from '../types'
import { fmt } from '../phase'

/**
 * Past drills: what was attempted, whether it landed, and what it cost.
 *
 * Reads `local/drill-log.md` through `GET /api/history`. That file is the only
 * structured record any track keeps — the design and behavioural tracks write
 * free-form transcripts with no scores — so this screen is honest about covering
 * the coding drills alone rather than implying it is a complete picture.
 *
 * **Cold solves are reported separately from solves, everywhere.** The log's own
 * preamble is emphatic about it: "a solve that took four hints is a different
 * fact from a cold solve, and the log is useless if it flattens them." A single
 * "7 of 9 solved" headline is exactly that flattening, so the headline figure
 * here is the cold count and the solve count sits behind it.
 *
 * **Patterns are off by default and come from the server only when asked for.**
 * A history screen is read between drills, and `/review` re-queues problems for
 * spaced repetition — a permanent problem-to-pattern list would spoil every
 * re-drill at a glance. The reveal is a deliberate act, like `/coach` is.
 *
 * **Every row is one line** (handoff §5). This is the most valuable screen in
 * the app and was the least usable, because a single 400-word note made one row
 * ~600px tall and buried the eight rows around it. The note column now shows its
 * first sentence and opens on demand, one at a time — the full text is still
 * one click away, but the *record* is readable as a record again.
 */

/** What each rung cost him, worded as what was already given away. Mirrors the drill toolbar. */
const RUNG = ['Cold', 'Nudged', 'Pattern named', 'Approach given', 'Solution shown'] as const

function rungLabel(hints: number): string {
  return RUNG[Math.min(Math.max(hints, 0), RUNG.length - 1)] ?? 'Unknown'
}

/**
 * The first sentence of a note, for the collapsed row.
 *
 * Deliberately not a character truncation: the notes open with a summary
 * sentence and continue into detail, so the first sentence is the part written
 * to be read alone. Falls back to the whole note when there is no sentence
 * break — CSS ellipsis catches the overflow either way.
 */
export function firstSentence(note: string): string {
  // The closing-markup class is load-bearing, not defensive. These notes open
  // with a bolded verdict — `**Real interview, not a drill.** Hints column is
  // n/a.` — where the terminator is followed by `*`, not a space. Requiring
  // whitespace immediately after the `.` skipped that break entirely and ran on
  // to the end of the note, which is the one outcome this function exists to
  // avoid. Trailing markers are consumed so the emphasis closes in the preview.
  const match = /^.*?[.!?][*_~`")'\]]*(?=\s|$)/.exec(note.trim())
  return match === null ? note.trim() : match[0]
}

/**
 * How a row reads at a glance.
 *
 * Three outcomes, not two. A solve that needed the full worked solution is not
 * the same result as a cold one, and colouring them identically would undo the
 * distinction the rest of this screen is built around.
 */
function tone(row: HistoryRow): 'cold' | 'helped' | 'partial' | 'unsolved' {
  // Checked before the boolean, because `solved` is false for a partial and
  // would otherwise tone it identically to an attempt that went nowhere.
  if (resultOf(row) === 'partial') return 'partial'
  if (!row.solved) return 'unsolved'
  return row.hints === 0 ? 'cold' : 'helped'
}

/**
 * The result column's three states.
 *
 * Falls back to the boolean when the server does not send `result` — an older
 * server has the same two states it always had, and inventing a third from a
 * boolean is not possible.
 *
 * `Partial` is the design's third verdict, in the treatment the handoff
 * specifies for it: `--foreground`, no red. The handoff's example wording was
 * "Correct, over budget", which the log has no column for — its cost outcome is
 * never written down. What the log *does* record is a partly-finished attempt,
 * and that is the same shape of fact: not a pass, and emphatically not a
 * failure. Naming it "Correct, over budget" would be claiming something the
 * record never said.
 */
export function resultOf(row: HistoryRow): DrillResult {
  if (row.result !== undefined) return row.result
  return row.solved ? 'solved' : 'unsolved'
}

const RESULT_LABEL: Record<DrillResult, string> = {
  solved: 'Solved',
  partial: 'Partial',
  unsolved: 'Not solved',
}

function useHistory(reveal: boolean): { payload: HistoryPayload | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ payload: HistoryPayload | null; loading: boolean; failed: boolean }>({
    payload: null,
    loading: true,
    failed: false,
  })

  useEffect(() => {
    let live = true
    setState((prev) => ({ ...prev, loading: true }))
    void (async () => {
      try {
        const res = await fetch(`/api/history${reveal ? '?patterns=1' : ''}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as HistoryPayload
        if (live) setState({ payload, loading: false, failed: false })
      } catch (error) {
        if (live) setState({ payload: null, loading: false, failed: true })
        console.error('voice: /api/history unreachable or unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [reveal])

  return state
}

/** One cell of the stat strip: a 10px label over a 23px tabular figure. */
function Stat({ label, value, of }: { label: string; value: string | number; of?: string }) {
  return (
    <div className="history__stat">
      <span className="history__stat-label">{label}</span>
      <span className="history__stat-value">
        {value}
        {of !== undefined && <span className="history__of"> {of}</span>}
      </span>
    </div>
  )
}

export function History({ onGoHome }: { onGoHome(): void }) {
  // Re-fetches when toggled rather than holding patterns client-side: the point
  // of withholding them is that they are not in the page until asked for.
  const [reveal, setReveal] = useState(false)
  const { payload, loading, failed } = useHistory(reveal)
  /**
   * Which row's note is open, by index. One at a time.
   *
   * A second open note pushes the first one's row off screen, which is the
   * behaviour this screen was redesigned to stop. Closing the previous one is
   * not a limitation — it is the feature.
   */
  const [openNote, setOpenNote] = useState<number | null>(null)

  const summary = payload?.summary
  const rows = payload?.rows ?? []
  /**
   * Problems that have been paired on, from `local/coached.md`.
   *
   * A set of slugs and nothing more, deliberately: the file has dates, but this
   * screen does not claim the pairing came before or after any particular
   * attempt. "This problem has been walked through at some point" is what the
   * data supports, and stating more than that would be the same flattening the
   * cold count exists to avoid.
   */
  const coached = new Set(payload?.coached ?? [])
  /**
   * Only the very first load blanks the screen.
   *
   * Toggling patterns refetches, and keying the table's visibility off `loading`
   * made the whole thing vanish and come back for a change that only adds a
   * column. `aria-busy` on the section still reports the refetch, so the state is
   * announced without the content leaving.
   */
  const firstLoad = loading && payload === null

  return (
    <div className="app-root">
      {/* Its own measure-constrained row rather than `home__header`, which is
          full-bleed: the title sat at x=0 while the table below it started at the
          content edge, so the screen read as two unrelated blocks. */}
      <header className="history__header">
        <h1 className="home__title">Past drills</h1>
        <Button variant="outline" onClick={onGoHome}>
          Back
        </Button>
      </header>

      <section className="history" aria-busy={loading} data-revealed={reveal ? '' : undefined}>
        {firstLoad && <p className="home__note">Loading your drill log…</p>}

        {failed && (
          <p className="home__note">
            Could not read the drill log. The other screens do not use it and still work.
          </p>
        )}

        {!firstLoad && !failed && summary?.attempts === 0 && (
          <div className="history__empty">
            <p>
              Nothing logged yet. A drill writes a row here when it finishes — from <code>/drill</code>,{' '}
              <code>/debug</code>, or the spoken coding and debugging tracks, all of which append to the same log.
            </p>
            <p className="home__note">
              There is no score to show and nothing is wrong. This screen is only useful once there are a few rows in
              it.
            </p>
          </div>
        )}

        {!firstLoad && !failed && summary !== undefined && summary.attempts > 0 && (
          <>
            {/* Cold solves lead. See the component comment for why that is not
                interchangeable with the solve count. */}
            <div className="history__summary">
              <Stat label="Solved cold" value={summary.cold} of={`of ${summary.attempts}`} />
              <Stat label="Solved with help" value={summary.solved - summary.cold} />
              {/* Partials come out of this figure rather than sitting silently
                  inside it. `attempts - solved` counted the CrowdStrike round —
                  optimal named at minute zero, half-written when time ran out —
                  as an attempt that went nowhere. */}
              <Stat
                label="Not solved"
                value={summary.attempts - summary.solved - (summary.partial ?? 0)}
                of={summary.partial ? `· ${summary.partial} partial` : undefined}
              />
              <Stat label="Problems seen" value={summary.problems} />
              <Stat
                label="Median, when solved"
                value={summary.medianSolvedMs === null ? '—' : fmt(Math.round(summary.medianSolvedMs / 1000))}
              />
            </div>

            <div className="history__controls">
              <Button variant="outline" onClick={() => setReveal((was) => !was)}>
                {reveal ? 'Hide patterns' : 'Reveal patterns'}
              </Button>
              <p className="home__note history__warning">
                {reveal
                  ? 'Patterns are showing. Re-drilling any problem listed here is spoiled while this is on.'
                  : 'Patterns are hidden, because a pattern is the answer — showing them would spoil a re-drill.'}
              </p>
            </div>

            <div className="history__table" role="table" aria-label="Past drills">
              <div className="history__head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Problem</span>
                {reveal && <span role="columnheader">Pattern</span>}
                <span role="columnheader">Result</span>
                <span role="columnheader">Help taken</span>
                <span role="columnheader">Time</span>
                <span role="columnheader">Note</span>
                <span role="columnheader" aria-label="Expand note" />
              </div>

              {rows.map((row, index) => {
                const open = openNote === index
                const helped = row.hints > 0 || coached.has(row.problem)
                return (
                  <div className="history__group" key={`${row.date}-${row.problem}-${index}`}>
                    <div className="history__row" role="row" data-tone={tone(row)}>
                      <span role="cell" className="history__date">
                        {row.date}
                      </span>
                      <span role="cell" className="history__problem">
                        {row.problem}
                      </span>
                      {reveal && (
                        <span role="cell" className="history__pattern">
                          {row.pattern ?? '—'}
                        </span>
                      )}
                      {/* A mono verdict, not a colour swatch — a red pill reads
                          as an alarm, and a drill you did not solve is a
                          measurement. Three states; see `resultOf`. */}
                      <span role="cell" className="history__result" data-result={resultOf(row)}>
                        {RESULT_LABEL[resultOf(row)]}
                      </span>
                      {/* Ochre when help was in fact taken, muted when it was not.
                          A cold solve and a four-rung solve must never look alike.
                          Paired is marked on the row rather than deducted from the
                          headline: a cold solve of a problem that has been paired
                          on is still a cold solve — nobody helped during the
                          attempt — but it is weaker evidence of recall, and only
                          he can weigh that. */}
                      <span role="cell" className="history__help" data-helped={helped ? '' : undefined}>
                        {rungLabel(row.hints)}
                        {coached.has(row.problem) && ' · paired'}
                      </span>
                      <span role="cell" className="history__time">
                        {row.elapsedMs === 0 ? '—' : fmt(Math.round(row.elapsedMs / 1000))}
                      </span>
                      <span role="cell" className="history__note-line">
                        {firstSentence(row.note)}
                      </span>
                      <span role="cell">
                        {row.note.trim() !== '' && (
                          <button
                            type="button"
                            className="history__toggle"
                            aria-expanded={open}
                            aria-label={open ? `Collapse note for ${row.problem}` : `Expand note for ${row.problem}`}
                            onClick={() => setOpenNote(open ? null : index)}
                          >
                            {open ? '−' : '+'}
                          </button>
                        )}
                      </span>
                    </div>

                    {open && <div className="history__note-full">{row.note}</div>}
                  </div>
                )
              })}
            </div>

            {rows.some((row) => coached.has(row.problem)) && (
              <p className="home__note">
                <strong>Paired</strong> means that problem appears in <code>local/coached.md</code> — you have been
                walked through it in a pairing session at some point, before or after the attempt shown. A cold solve of
                a paired problem is still a cold solve, but it is weaker evidence of recall than one on a problem you
                have never had explained.
              </p>
            )}

            <p className="home__note">
              Coding drills and debugging exercises — the two tracks that write a scored row. The design and
              behavioural tracks write transcripts to <code>local/</code> rather than scores, so there is nothing
              comparable to list. A debugging row is the one whose pattern reads <code>debugging</code>, and{' '}
              <strong>solved</strong> there means the root cause rather than a symptom patch. For the full debrief on
              any row, run <code>/review &lt;problem&gt;</code>.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
