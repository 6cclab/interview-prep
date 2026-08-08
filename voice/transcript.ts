import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Track } from './context'

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

const TRAILER = /```story-log\n([\s\S]*?)```/g
const OPEN_MARKER = /```story-log\n/

/**
 * Separate the interviewer's spoken words from the structured trailer it emits
 * after a behavioral critique. The trailer feeds `local/stories.md`; it must
 * never reach the speech synthesiser.
 */
export function splitTrailer(text: string): { spoken: string; log: StoryLog | null } {
  const match = TRAILER.exec(text)
  TRAILER.lastIndex = 0

  if (!match) {
    // No well-formed block. If an opening marker is present, the trailer was
    // truncated mid-block — suppress it and everything after it from speech.
    const open = OPEN_MARKER.exec(text)
    if (open) return { spoken: text.slice(0, open.index).trim(), log: null }
    return { spoken: text.trim(), log: null }
  }

  const fields = new Map<string, string>()
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }

  const spoken = text.replace(TRAILER, '').trim()
  const competency = fields.get('competency')
  const story = fields.get('story')
  const worked = fields.get('worked')
  const fix = fields.get('fix')
  if (!competency || !story || !worked || !fix) return { spoken, log: null }

  return { spoken, log: { competency, story, worked, fix } }
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

export function formatSession(entries: Entry[], startedAt: Date): string {
  const lines = [`# Voice session — ${startedAt.toISOString()}`, '']
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
export function writeSession(root: string, relPath: string, body: string): string {
  const full = join(root, relPath)
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

export function appendStoryLog(root: string, log: StoryLog): void {
  const full = join(root, 'local/stories.md')
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
