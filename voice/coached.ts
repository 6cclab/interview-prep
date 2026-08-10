import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The record of which problems have been coached, and when.
 *
 * **Its own file, not a row in `local/drill-log.md`, and this is the important
 * part of the coaching track rather than a filing detail.** `voice/drill-log.ts`
 * counts attempts, solves and *cold* solves, and the history screen leads with
 * the cold count — that was the whole argument for reporting cold separately
 * ("a solve that took four hints is a different fact from a cold solve"). A
 * coaching session is not an attempt: nobody was tested. Writing one into the
 * drill log would have to either fake an attempt or leave `hints` at zero, and
 * the second inflates the one number the screen asks you to trust.
 *
 * Adding a column to the drill log instead is not available: `parseDrillLog`
 * maps cells by position, so a new column would break every existing row.
 *
 * What this file *is* for is the reading afterwards. A cold solve of a problem
 * you were walked through last week is a different fact again, and this is where
 * that shows up.
 */

const HEADER = [
  '# Coached',
  '',
  'Problems walked through in a pairing session, appended by the coaching track.',
  '',
  '**Not attempts.** Nobody was tested here, so these rows are deliberately not in',
  '`local/drill-log.md` — that file counts attempts and cold solves, and a coaching',
  'session counted as either would corrupt the only numbers `/status` and the',
  'history screen report. Read this beside the log: a cold solve of a problem that',
  'appears here is a different fact from a cold solve of one that does not.',
  '',
  '| Date | Problem | Pattern | Minutes |',
  '|------|---------|---------|---------|',
]

export interface CoachedRow {
  date: string
  problem: string
  pattern: string
  minutes: number
}

/** `YYYY-MM-DD` in local time — a session at 9pm should file under the day it felt like. */
export function isoDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

export function formatCoachedRow(row: CoachedRow): string {
  return `| ${row.date} | ${row.problem} | ${row.pattern} | ${row.minutes} |`
}

/**
 * Appends one row, creating the file with its preamble if it does not exist.
 *
 * Creates rather than requiring `pnpm bootstrap`, because unlike the drill log
 * this file has no committed seed in `templates/local/` — the first coaching
 * session is what brings it into being, and failing to record it because a
 * template was missing would lose the fact silently.
 *
 * Returns the relative path written, or null if nothing could be written. Never
 * throws: a session's transcript is the product, and losing it to a failed
 * bookkeeping append would be the wrong trade.
 */
export function appendCoached(root: string, row: CoachedRow): string | null {
  const relPath = 'local/coached.md'
  const full = join(root, relPath)
  try {
    const body = existsSync(full) ? '' : `${HEADER.join('\n')}\n`
    appendFileSync(full, `${body}${formatCoachedRow(row)}\n`, 'utf8')
    return relPath
  } catch (error) {
    console.error(`voice: could not append to ${relPath}`, error)
    return null
  }
}

/** Problem slugs that appear in `local/coached.md`. Empty when the file does not exist. */
export function readCoachedProblems(root: string): string[] {
  const full = join(root, 'local/coached.md')
  if (!existsSync(full)) return []
  const slugs = new Set<string>()
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    // Data rows only: the header row and its dashes both start with a pipe too.
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 5) continue
    const [, date, problem] = cells
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue
    if (problem) slugs.add(problem)
  }
  return [...slugs]
}
