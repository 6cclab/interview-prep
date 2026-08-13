import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isoDate } from './coached'
import type { Track } from './context'
import { userDataDir } from './user-root'

export interface Entry {
  speaker: 'interviewer' | 'andre'
  text: string
  /** Milliseconds since the session started. */
  at: number
}

export interface StoryLog {
  competency: string
  story: string
  worked: string
  fix: string
}

/**
 * The interviewer's own verdict on a coding drill.
 *
 * Only the two things a model is the right source for: whether he actually solved
 * it, and the one-line note `drill.md` asks for. Everything else in a drill-log
 * row — the date, the problem, the pattern, the hint rung, the elapsed time — is
 * a fact the server already holds, and asking a language model to recall a
 * number it was told forty minutes ago is how a log stops being trustworthy.
 */
export interface DrillLog {
  solved: boolean
  note: string
}

/**
 * Pull a fenced `key: value` trailer out of an interviewer's reply.
 *
 * Shared by both trailer kinds. The tag is interpolated into a pattern rather
 * than matched loosely, so a `story-log` block can never be read as a
 * `drill-log` one — they carry different fields and a cross-read would write
 * nonsense into whichever file consumed it.
 *
 * A truncated block (an opening fence with no close) suppresses itself and
 * everything after it from speech: half a trailer read aloud is worse than a
 * missing log row, because the drill is over either way but the recording is not.
 */
function splitFenced(text: string, tag: string): { spoken: string; fields: Map<string, string> | null } {
  const body = '```' + tag + '\\n([\\s\\S]*?)```'
  const match = new RegExp(body).exec(text)
  // A separate global copy for the strip. One shared regex cannot do both jobs:
  // `exec` must be non-global to read the *first* block's fields, but the strip
  // must be global or a second block survives and gets spoken aloud.
  const strip = new RegExp(body, 'g')

  if (!match) {
    const open = new RegExp('```' + tag + '\\n').exec(text)
    if (open) return { spoken: text.slice(0, open.index).trim(), fields: null }
    return { spoken: text.trim(), fields: null }
  }

  const fields = new Map<string, string>()
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return { spoken: text.replace(strip, '').trim(), fields }
}

/**
 * Separate the interviewer's spoken words from the structured trailer it emits
 * after a behavioral critique. The trailer feeds `local/stories.md`; it must
 * never reach the speech synthesiser.
 */
export function splitTrailer(text: string): { spoken: string; log: StoryLog | null } {
  const { spoken, fields } = splitFenced(text, 'story-log')
  if (!fields) return { spoken, log: null }

  const competency = fields.get('competency')
  const story = fields.get('story')
  const worked = fields.get('worked')
  const fix = fields.get('fix')
  if (!competency || !story || !worked || !fix) return { spoken, log: null }

  return { spoken, log: { competency, story, worked, fix } }
}

/**
 * The coding track's equivalent: the interviewer's closing verdict.
 *
 * `solved` is read strictly — only an explicit `yes` counts. A missing, garbled
 * or hedged value logs the drill as unsolved, which is the safe direction: a
 * solve wrongly recorded as a miss shows up as a pattern to re-drill, while a
 * miss wrongly recorded as a solve removes it from the queue and quietly rots
 * the one number `/status` uses to find rust.
 */
export function splitDrillLog(text: string): { spoken: string; log: DrillLog | null } {
  const { spoken, fields } = splitFenced(text, 'drill-log')
  if (!fields) return { spoken, log: null }

  const solved = fields.get('solved')
  const note = fields.get('note')
  if (solved === undefined || !note) return { spoken, log: null }

  return { spoken, log: { solved: solved.trim().toLowerCase() === 'yes', note } }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/**
 * `2026-08-08-1850` — the date plus the session's start time to the minute.
 *
 * The date alone is not a unique name: two drills on the same day resolved to
 * the same path, and `writeSession` overwrites, so the second silently
 * destroyed the first. Minute precision separates ordinary back-to-back drills
 * while staying readable.
 *
 * It is not a uniqueness *guarantee*, and nothing here should be read as one:
 * ending a session and starting another inside the same minute is a supported
 * flow (the stuck-session banner's "End it and start fresh" does exactly that),
 * so two sessions can legitimately share a stamp. `writeSession`'s refusal to
 * overwrite is what makes that safe — this only keeps the common case tidy.
 */
function isoStamp(at: Date): string {
  const iso = at.toISOString()
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`
}

/**
 * @param transport Which backend and model conducted the session, e.g.
 *   `cli / claude-sonnet-5`. Optional because `cli.ts` does not pass one, and a
 *   transcript with no line is better than a wrong one. Recorded at all because
 *   a drill on 2026-08-10 read wrong — the interviewer conducted it in the third
 *   person — and nothing in the file said what had produced it, so the diagnosis
 *   rested on commit timestamps rather than on the artifact.
 * @param editor Where a coding drill's answer was written — `browser` or `own`.
 *   Optional for the same reason `transport` is: a design or behavioural drill
 *   has no editing mode, and a header line claiming one would be a wrong line
 *   rather than a missing one.
 */
export function formatSession(entries: Entry[], startedAt: Date, transport?: string, editor?: string): string {
  const lines = [`# Voice session — ${startedAt.toISOString()}`, '']
  if (transport) lines.push(`Interviewer: ${transport}`, '')
  // Recorded beside the transport for the same reason: a transcript read days
  // later has to say what produced it. The drill-log table is deliberately NOT
  // where this goes — its columns are parsed by `/status` and the `#/history`
  // screen, so adding one is a schema change with two readers to update.
  if (editor) lines.push(`Editor: ${editor}`, '')
  for (const entry of entries) {
    const who = entry.speaker === 'interviewer' ? 'Interviewer' : 'Andre'
    lines.push(`**${who}** [${clock(entry.at)}]`, '', entry.text, '')
  }
  return lines.join('\n')
}

export function sessionPath(track: Track, startedAt: Date, problem?: string): string {
  if (track === 'design') {
    if (!problem) throw new Error('A design session needs a problem name.')
    return `local/designs/${problem}-live-${isoStamp(startedAt)}.md`
  }
  if (track === 'coach') {
    if (!problem) throw new Error('A coaching session needs a problem name.')
    // Its own directory, not `local/drills/`: a coaching session is not an
    // attempt, and `/status` and the history screen read attempts. Same
    // slug-only rule as below — the pattern is the answer, and here it is also
    // the subject, so a filename that named it would spoil a future re-drill of
    // the same problem.
    return `local/coaching/${problem}-${isoStamp(startedAt)}.md`
  }
  if (track === 'debug') {
    if (!problem) throw new Error('A debugging session needs an exercise name.')
    // Its own directory rather than `local/drills/`, which is the coding track's.
    // The two write the same drill-log table — `/status` reads exactly one log —
    // but a transcript is read by hand and mixing the two tracks in one folder
    // makes "what did I do on Tuesday" harder than it needs to be.
    return `local/debugging/${problem}-live-${isoStamp(startedAt)}.md`
  }
  if (track === 'coding') {
    if (!problem) throw new Error('A coding session needs a problem name.')
    // By problem slug, never by `problems/<pattern>/<slug>` — the pattern is the
    // answer, and a filename he sees in his own `local/` would spoil the drill
    // as thoroughly as reading it off the screen mid-session.
    return `local/drills/${problem}-live-${isoStamp(startedAt)}.md`
  }
  return `local/mock-${isoStamp(startedAt)}.md`
}

/**
 * Writes a session transcript, and **returns the path it actually used** — which
 * may not be `relPath`.
 *
 * A transcript is the entire product of a drill and there is no undo: `local/` is
 * gitignored, so an overwrite is unrecoverable. `sessionPath` now makes
 * collisions essentially impossible, but "essentially impossible" is the wrong
 * guarantee for unrecoverable data, so an occupied path gets a `-2`, `-3` suffix
 * rather than being clobbered. Callers must use the returned path, not the one
 * they passed in.
 */
export function writeSession(root: string, userId: string | null, relPath: string, body: string): string {
  // `sessionPath` always returns a `local/`-prefixed path — that convention is
  // unchanged by this parameter, so the `local` segment is swapped for
  // `userDataDir`'s answer rather than `sessionPath` itself learning about
  // users. For `userId: null` `userDataDir` returns `join(root, 'local')`
  // byte-for-byte, so this reduces to the original `join(root, relPath)`.
  const within = relative('local', relPath)
  // That swap is only correct while the prefix is really there. Without this
  // the failure is silent and lands in the worst place available: `coaching/x`
  // resolves to `local/users/coaching/x`, outside the user's directory and
  // inside the namespace where other users' directories live. Unreachable from
  // `sessionPath` today, guarded because a transcript overwrite has no undo.
  if (isAbsolute(relPath) || within.startsWith('..')) {
    throw new Error(`A session path must be under local/, got ${JSON.stringify(relPath)}`)
  }
  const full = join(userDataDir(root, userId), within)
  mkdirSync(dirname(full), { recursive: true })
  const free = firstFreePath(full)
  writeFileSync(free, body)
  return relative(root, free)
}

function firstFreePath(full: string): string {
  if (!existsSync(full)) return full
  // `> lastSep + 1`, not `> lastSep`: a leading dot makes a dotfile, not an
  // extension, so `.hidden` must suffix to `.hidden-2` rather than splitting
  // into an empty stem and a `.hidden` extension.
  const dot = full.lastIndexOf('.')
  const lastSep = full.lastIndexOf(sep)
  const [stem, ext] = dot > lastSep + 1 ? [full.slice(0, dot), full.slice(dot)] : [full, '']
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!existsSync(candidate)) return candidate
  }
}

/** One row of `local/drill-log.md`, in that table's column order. */
export interface DrillLogRow {
  startedAt: Date
  problem: string
  /** The pattern. Fine here and nowhere else: `local/` is his own record, and the log has always carried this column. */
  pattern: string
  solved: boolean
  /** Highest rung reached, 0-4. Counted by the server, not recalled by the interviewer. */
  hints: number
  elapsedMs: number
  note: string
}

/**
 * Append a row to `local/drill-log.md`, creating the table if it is missing.
 *
 * The same file `/drill` appends to, in the same shape, on purpose: `/status`
 * reads exactly one log to find rusty patterns, and a spoken drill that wrote
 * somewhere else would leave that report quietly blind to half the practice —
 * which is what it was before this existed.
 */
export function appendDrillLog(root: string, userId: string | null, row: DrillLogRow): void {
  const full = join(userDataDir(root, userId), 'drill-log.md')
  mkdirSync(dirname(full), { recursive: true })
  const header = '| Date | Problem | Pattern | Solved | Hints | Time | Note |'
  const existing = existsSync(full) ? readFileSync(full, 'utf8') : ''
  const lines: string[] = []
  if (!existing.includes(header)) {
    // A log seeded by `pnpm bootstrap` already has the header and the preamble
    // explaining what `Hints` means. This branch is for a `local/` that does not.
    if (existing.length > 0 && !existing.endsWith('\n')) lines.push('')
    lines.push('', header, '|------|---------|---------|--------|-------|------|------|')
  } else if (!existing.endsWith('\n')) {
    lines.push('')
  }
  // Pipes would split the row into extra columns. Escaped rather than stripped,
  // so the note still reads as written.
  const note = row.note.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
  // `isoDate` (local), not `toISOString().slice(0, 10)` (UTC). It was the latter,
  // and west of UTC that files an evening drill under *tomorrow*: measured at
  // 20:34 EDT the row came out dated the 11th, while the row appended forty
  // minutes earlier said the 10th — two drills from one sitting, a day apart.
  // This is the file `/status` and `#/history` read, so the date is not
  // cosmetic: it drives which patterns look rusty and how long ago a problem was
  // last seen. Same rule `voice/coached.ts` states for its own rows — a session
  // at 9pm files under the day it felt like.
  lines.push(
    `| ${isoDate(row.startedAt)} | ${row.problem} | ${row.pattern} | ${
      row.solved ? 'yes' : 'no'
    } | ${row.hints} | ${clock(row.elapsedMs)} | ${note} |`,
  )
  appendFileSync(full, `${lines.join('\n')}\n`)
}

export function appendStoryLog(root: string, userId: string | null, log: StoryLog): void {
  const full = join(userDataDir(root, userId), 'stories.md')
  mkdirSync(dirname(full), { recursive: true })
  const hasExistingContent = existsSync(full) && readFileSync(full, 'utf8').length > 0
  const entry = [
    ...(hasExistingContent ? [''] : []),
    `## ${log.competency}`,
    '',
    `**Story.** ${log.story}`,
    '',
    `**What worked.** ${log.worked}`,
    '',
    `**Fix next time.** ${log.fix}`,
    '',
  ].join('\n')
  appendFileSync(full, entry)
}
