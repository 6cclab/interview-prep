import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DrillLogRow } from './transcript'

/**
 * Reads `local/drill-log.md` back.
 *
 * `appendDrillLog` has always written this table and nothing has ever parsed it,
 * so the record existed only to be read by eye. This is the other half, for the
 * history screen.
 *
 * Tolerant on purpose. The log is a markdown file he edits by hand — `/drill`
 * appends to it, but so does he, and `/review` is told to annotate it. A row that
 * does not parse is skipped rather than throwing, because one fat-fingered line
 * must not blank out the whole history. What cannot be recovered is dropped
 * silently; what can be is kept even if some fields are odd.
 */

/**
 * What the Solved column actually said, as three values rather than two.
 *
 * The column has never been yes/no in practice — `local/drill-log.md` carries a
 * `partial` row (the 2026-08-19 CrowdStrike round: the optimal was named at
 * minute zero and half-written when time ran out), and the parser's strict
 * `=== 'yes'` test correctly refused to count it as a solve but then had nowhere
 * to put it, so the screen reported it as **Not solved**. That is the same
 * flattening the log's own preamble forbids, one column over: "a solve that took
 * four hints is a different fact from a cold solve, and the log is useless if it
 * flattens them."
 *
 * `partial` is deliberately its own value and not a shade of failure. Anything
 * the file does not say explicitly is `unsolved` — the strictness is unchanged,
 * only the vocabulary is wider.
 */
export type DrillResult = 'solved' | 'partial' | 'unsolved'

/** A parsed row, plus the fields the screen derives rather than stores. */
export interface HistoryRow extends Omit<DrillLogRow, 'startedAt'> {
  /** `YYYY-MM-DD`, exactly as written. Not a Date: the log has no time of day. */
  date: string
  /**
   * The three-valued reading of the Solved column.
   *
   * `solved` stays alongside it and stays exactly as strict — every count on the
   * screen is derived from that boolean, and widening it would silently inflate
   * the cold-solve figure the whole record is built around. This field is for
   * *display*; `solved` is for arithmetic.
   */
  result: DrillResult
}

/** The words the log uses for a partly-finished attempt. Anything else is not one. */
const PARTIAL = new Set(['partial', 'partly'])

export function readResult(cell: string): DrillResult {
  const word = cell.trim().toLowerCase()
  if (word === 'yes') return 'solved'
  if (PARTIAL.has(word)) return 'partial'
  return 'unsolved'
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9-]+$/
/** `m:ss` or `mm:ss`, as `clock()` writes it. */
const CLOCK = /^(\d+):([0-5]\d)$/

/** Splits a markdown table row into trimmed cells, honouring `\|` escapes. */
export function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    // `appendDrillLog` escapes pipes in the note so they do not split the row.
    // Unescaping here is what makes a note containing a pipe survive a round trip.
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

/** `m:ss` to milliseconds, or `null` if it is not a clock. */
export function parseClock(text: string): number | null {
  const found = CLOCK.exec(text)
  if (!found) return null
  return (Number(found[1]) * 60 + Number(found[2])) * 1000
}

/**
 * Every parseable row, newest first.
 *
 * Newest first because that is the order the screen wants and the order the
 * question "how am I doing" is asked in. The file itself is append-only, so it is
 * oldest-first on disk.
 */
export function parseDrillLog(markdown: string): HistoryRow[] {
  const rows: HistoryRow[] = []
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = splitRow(line)
    // Date | Problem | Pattern | Solved | Hints | Time | Note
    if (cells.length < 7) continue
    const [date, problem, pattern, solved, hints, time, ...rest] = cells as string[]
    // Skips the header and the `|---|` separator without matching on their text:
    // anything whose first cell is not a date is not a data row.
    if (!DATE.test(date!) || !SLUG.test(problem!)) continue

    const elapsedMs = parseClock(time!)
    const rung = Number(hints)
    rows.push({
      date: date!,
      problem: problem!,
      pattern: SLUG.test(pattern!) ? pattern! : '',
      // Strict, matching `splitDrillLog`: only an explicit yes is a solve, so a
      // hand-written "partly" never counts as one. `result` below keeps the
      // distinction this boolean has to throw away — see `DrillResult`.
      solved: solved!.toLowerCase() === 'yes',
      result: readResult(solved!),
      hints: Number.isInteger(rung) && rung >= 0 && rung <= 4 ? rung : 0,
      elapsedMs: elapsedMs ?? 0,
      // Rejoined rather than taking cells[6]: an unescaped pipe typed by hand
      // would otherwise silently truncate the note at the pipe.
      note: rest.join(' | ').trim(),
    })
  }
  return rows.reverse()
}

export function readDrillLog(root: string): HistoryRow[] {
  const full = join(root, 'local/drill-log.md')
  if (!existsSync(full)) return []
  try {
    return parseDrillLog(readFileSync(full, 'utf8'))
  } catch {
    // An unreadable log is an empty history, not a broken screen.
    return []
  }
}

export interface HistorySummary {
  attempts: number
  solved: number
  /**
   * Rows the log marks `partial`.
   *
   * Its own figure rather than folded into the not-solved count, which is where
   * it silently sat: `attempts - solved` counted a round where the optimal was
   * named and half-written as an attempt that went nowhere. Never added to
   * `solved` — a partial is not a solve — so every existing figure is unchanged.
   */
  partial: number
  /** Solved at rung 0 — the only figure that means the recall was actually there. */
  cold: number
  /** Distinct problems attempted, which is coverage rather than fluency. */
  problems: number
  /** Median elapsed ms across solved attempts, or null when none are solved. */
  medianSolvedMs: number | null
}

/**
 * The figures worth putting at the top of the screen.
 *
 * `cold` is separated from `solved` because `local/drill-log.md`'s own preamble
 * insists on it — "a solve that took four hints is a different fact from a cold
 * solve, and the log is useless if it flattens them." A single "solved: 7 of 9"
 * headline would flatten exactly that.
 *
 * Median rather than mean: one 45-minute session that ran to time would drag a
 * mean far away from anything typical, and with a handful of rows that is likely
 * rather than hypothetical.
 */
export function summarise(rows: HistoryRow[]): HistorySummary {
  const solvedRows = rows.filter((row) => row.solved)
  const times = solvedRows.map((row) => row.elapsedMs).sort((a, b) => a - b)
  const mid = Math.floor(times.length / 2)
  return {
    attempts: rows.length,
    solved: solvedRows.length,
    partial: rows.filter((row) => row.result === 'partial').length,
    cold: rows.filter((row) => row.solved && row.hints === 0).length,
    problems: new Set(rows.map((row) => row.problem)).size,
    medianSolvedMs:
      times.length === 0 ? null : times.length % 2 === 1 ? times[mid]! : Math.round((times[mid - 1]! + times[mid]!) / 2),
  }
}
