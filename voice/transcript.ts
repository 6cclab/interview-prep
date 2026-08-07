import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
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
    return `local/designs/${problem}-live-${isoDate(startedAt)}.md`
  }
  return `local/mock-${isoDate(startedAt)}.md`
}

export function writeSession(root: string, relPath: string, body: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
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
