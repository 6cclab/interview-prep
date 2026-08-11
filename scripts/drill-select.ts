import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryRow } from '../voice/drill-log'
import type { CodingProblem } from '../voice/problems'

/**
 * The decisions `/drill` makes, as functions.
 *
 * `prompts/drill.md` describes a drill a language model runs. Almost
 * none of it actually needs one: selecting by rust is a sort over the log,
 * classifying a red is already `voice/drill-tests.ts`, and two of the four hint
 * rungs are authored files sitting on disk. What genuinely needed a model was
 * the conversational judgement — and that is the part `scripts/drill.ts` hands
 * back to the candidate instead of faking.
 *
 * Everything here is pure so the choices can be tested without a terminal.
 */

/** One YAML-ish nested field, e.g. `hints.nudge`. */
function readBlockField(yaml: string, block: string, field: string): string | undefined {
  // meta.yaml is read with line-anchored regexes throughout this repo rather
  // than a YAML dependency. The block is matched first and the field only
  // within it, so a top-level `time:` cannot be mistaken for `complexity.time`.
  const blockMatch = new RegExp(`^${block}:[ \\t]*\\n((?:[ \\t]+\\S.*\\n?)*)`, 'm').exec(yaml)
  if (!blockMatch?.[1]) return undefined
  const fieldMatch = new RegExp(`^[ \\t]+${field}:[ \\t]*(.*)$`, 'm').exec(blockMatch[1])
  const value = fieldMatch?.[1]?.trim()
  if (!value) return undefined
  // Strip one layer of surrounding quotes, which authors reach for when a value
  // contains a colon — `time: "O(n): one pass"` is otherwise invalid YAML.
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

export interface AuthoredHints {
  /** Rung 1: a nudge phrased as a question that does not name the pattern. */
  nudge?: string
  /** Rung 3: the approach in words, no code. */
  approach?: string
}

export interface AuthoredComplexity {
  time?: string
  space?: string
}

export function readAuthored(dir: string): { hints: AuthoredHints; complexity: AuthoredComplexity } {
  const path = join(dir, 'meta.yaml')
  if (!existsSync(path)) return { hints: {}, complexity: {} }
  const yaml = readFileSync(path, 'utf8')
  return {
    hints: {
      nudge: readBlockField(yaml, 'hints', 'nudge'),
      approach: readBlockField(yaml, 'hints', 'approach'),
    },
    complexity: {
      time: readBlockField(yaml, 'complexity', 'time'),
      space: readBlockField(yaml, 'complexity', 'space'),
    },
  }
}

export interface Rung {
  /** 1–4, matching `rules/no-spoilers.md`. */
  rung: number
  /** What to show. Absent when nobody has authored this rung for this problem. */
  text?: string
  /** For rung 4 only: the file to print, rather than text held here. */
  file?: string
  /** Why there is nothing to show, when there isn't. */
  missing?: string
}

/**
 * One rung of the ladder, for one problem.
 *
 * Rungs 2 and 4 need no authoring at all and never did: rung 2 is the pattern
 * name, which is `meta.yaml`'s `pattern:` field, and rung 4 is the full worked
 * solution, which is the file under `solutions/`. So a problem with nothing
 * authored still has half a working ladder — and the two rungs it is missing say
 * so, rather than silently skipping to the next one.
 */
export function rungFor(
  rung: number,
  ctx: { pattern: string; hints: AuthoredHints; solutionPath: string },
): Rung {
  switch (rung) {
    case 1:
      return ctx.hints.nudge
        ? { rung, text: ctx.hints.nudge }
        : { rung, missing: 'No nudge authored for this problem (meta.yaml `hints.nudge`).' }
    case 2:
      // Deliberately the bare name and nothing else, per the ladder.
      return { rung, text: ctx.pattern }
    case 3:
      return ctx.hints.approach
        ? { rung, text: ctx.hints.approach }
        : { rung, missing: 'No approach authored for this problem (meta.yaml `hints.approach`).' }
    case 4:
      return existsSync(ctx.solutionPath)
        ? { rung, file: ctx.solutionPath }
        : { rung, missing: `No worked solution at ${ctx.solutionPath}.` }
    default:
      return { rung, missing: `No rung ${rung}. The ladder has four.` }
  }
}

export interface Selection {
  problem: CodingProblem
  /** One line on why this one, printed so the choice is auditable. */
  why: string
}

/**
 * Which problem to drill, by rust.
 *
 * The order is `drill.md`'s, unchanged: never attempted first, then longest
 * since a clean solve, then anything solved at rung 3 or worse. A "clean solve"
 * means solved at rung 0 — a solve that needed the answer spelled out is not
 * evidence of recall, which is the whole reason the log records the rung.
 *
 * Ties break on the problem list's own order rather than at random, so the same
 * log picks the same problem twice. A drill you cannot reproduce is a drill you
 * cannot compare against.
 */
export function selectByRust(problems: CodingProblem[], rows: HistoryRow[]): Selection | null {
  if (problems.length === 0) return null

  const attempts = new Map<string, HistoryRow[]>()
  for (const row of rows) {
    const list = attempts.get(row.problem) ?? []
    list.push(row)
    attempts.set(row.problem, list)
  }

  const never = problems.filter((p) => !attempts.has(p.slug))
  if (never.length > 0) {
    return { problem: never[0]!, why: 'never attempted' }
  }

  // `readDrillLog` returns newest first, so the first clean solve in a
  // problem's rows is its most recent one.
  const cleanest = problems
    .map((problem) => {
      const rows = attempts.get(problem.slug) ?? []
      const lastClean = rows.find((r) => r.solved && r.hints === 0)
      return { problem, lastClean: lastClean?.date }
    })
    .filter((entry) => entry.lastClean !== undefined)
    .sort((a, b) => (a.lastClean! < b.lastClean! ? -1 : a.lastClean! > b.lastClean! ? 1 : 0))

  const helped = problems.filter((problem) => {
    const rows = attempts.get(problem.slug) ?? []
    return rows.length > 0 && !rows.some((r) => r.solved && r.hints === 0)
  })

  // Helped-only problems outrank stale clean solves: a problem never solved
  // cold is a gap, while a problem solved cold six weeks ago is only cold
  // storage. `drill.md` orders it the other way round for the case where
  // everything has been solved cleanly at some point, which this preserves —
  // `helped` is empty then.
  if (helped.length > 0) {
    return { problem: helped[0]!, why: 'never solved cold' }
  }
  if (cleanest.length > 0) {
    return { problem: cleanest[0]!.problem, why: `longest since a cold solve (${cleanest[0]!.lastClean})` }
  }
  return { problem: problems[0]!, why: 'first in the set' }
}

/** Matches a slug exactly, else every problem under a pattern of that name. */
export function resolveTarget(problems: CodingProblem[], target: string): CodingProblem[] {
  const exact = problems.find((p) => p.slug === target)
  if (exact) return [exact]
  return problems.filter((p) => p.pattern === target)
}

/** `mm:ss`, or `h:mm:ss` past an hour. The format `voice/drill-log.ts` parses. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export interface LogRow {
  date: string
  problem: string
  pattern: string
  solved: boolean
  hints: number
  elapsedMs: number
  note: string
}

/**
 * One `local/drill-log.md` row.
 *
 * Pipes in the note are escaped rather than stripped: `voice/drill-log.ts`
 * honours `\|`, and a note is free text a candidate typed — silently deleting a
 * character out of their own words is worse than the table looking odd.
 */
export function formatLogRow(row: LogRow): string {
  const note = row.note.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
  const cells = [
    row.date,
    row.problem,
    row.pattern,
    row.solved ? 'yes' : 'no',
    String(row.hints),
    formatClock(row.elapsedMs),
    note || '—',
  ]
  return `| ${cells.join(' | ')} |`
}
