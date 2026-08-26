/**
 * The written record a `/live` session produces.
 *
 * Kept apart from `live.ts` because capture and artifact fail differently:
 * capture fails loudly at the start (no device, a loopback, ffmpeg missing),
 * and this fails quietly at the end (a model that ignored the format, a
 * section that came back empty). Both halves are pure functions over strings so
 * the failure modes can be tested without a microphone or a model.
 */

/** The two provenances. Same artifact shape — the difference is what produced it. */
export type LiveMode = 'live' | 'debrief'

export interface LiveHeader {
  company: string
  /** e.g. "technical screen", "final round". Free text; it is his record. */
  round: string
  mode: LiveMode
  startedAt: Date
  durationMs: number
  device: string
  model: string
}

/** `47m`, `1h 12m`, `4m`. Minutes are the useful resolution for a round. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/**
 * The summary, as the model returned it, split into the two sections the
 * artifact has slots for.
 *
 * `openQuestions` is the half that matters most and the half most likely to go
 * missing: it is the model listing what it *could not* determine from one side
 * of a conversation, and a model that skips it produces a summary that reads as
 * complete when it is half a conversation. So its absence is represented
 * explicitly rather than as an empty string — see `formatArtifact`, which says
 * so on the page rather than leaving a blank heading.
 */
export interface LiveSummary {
  summary: string
  openQuestions: string | null
}

const OPEN_QUESTIONS = /^##+\s*open questions\s*$/im

/**
 * Split a model's reply into summary and open questions.
 *
 * Tolerant on purpose. The prompt asks for two headed sections, and a local
 * model will sometimes return one section, or head them differently, or wrap
 * the whole thing in prose. The rule here is that whatever cannot be parsed
 * stays visible as the summary rather than being dropped — losing the model's
 * output to a formatting mismatch is worse than an artifact with an untidy
 * section, because the recording is gone by then and this is all that is left.
 */
export function splitSummary(reply: string): LiveSummary {
  const text = reply.trim()
  const lines = text.split('\n')
  const at = lines.findIndex((line) => OPEN_QUESTIONS.test(line))
  if (at === -1) return { summary: text, openQuestions: null }
  const summary = lines.slice(0, at).join('\n').trim()
  const open = lines.slice(at + 1).join('\n').trim()
  // A heading with nothing under it is the same as no section, and pretending
  // otherwise puts an empty list on the page where a warning belongs.
  return { summary, openQuestions: open === '' ? null : open }
}

/**
 * Strip the leading `## Summary` the model may or may not have emitted.
 *
 * The artifact supplies its own headings, so one arriving in the body renders
 * as a heading inside a section — harmless but scruffy, and scruffy output is
 * what stops a record being read.
 */
export function stripSummaryHeading(summary: string): string {
  return summary.replace(/^##+\s*summary\s*\n+/i, '').trim()
}

/** One transcribed segment, with the offset it began at. */
export interface TranscribedSegment {
  /** Milliseconds from the start of the session. */
  offsetMs: number
  text: string
}

/** `[00:05:00]` — offset from the start of the round, not wall-clock time. */
export function stamp(offsetMs: number): string {
  const total = Math.floor(offsetMs / 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `[${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}]`
}

/**
 * Segments joined into a transcript.
 *
 * Each segment is stamped with where it began, which is the only timing
 * information a segmented capture can honestly offer: whisper's own
 * intra-segment timings are relative to a file whose timestamps were reset, so
 * combining them would require adding the offset back and would be reporting a
 * precision this does not have. The segment length is the resolution.
 *
 * Empty segments are kept, as a marked gap. Silence is data here — the plan
 * asks the summary to report where he stalled — and dropping a silent five
 * minutes would make the record say the round was five minutes shorter.
 *
 * The `_(silence)_` marker is a floor, not a silence detector. Measured on a
 * 20-second capture of an empty room, whisper returned "Thank you." for all
 * four segments rather than an empty string — it hallucinates on near-silence,
 * a known and well-documented whisper behaviour. So this catches the segments
 * whisper *admits* are empty and nothing more; a stall shows up in the record
 * as a stretch of implausible filler, which is why `prompts/live-summary.md`
 * tells the summariser to read through obviously mangled words rather than
 * quoting them.
 */
export function formatTranscript(segments: TranscribedSegment[]): string {
  if (segments.length === 0) return '_Nothing was transcribed._'
  return segments
    .map(({ offsetMs, text }) => {
      const body = text.trim()
      return body === ''
        ? `${stamp(offsetMs)} _(silence)_`
        : `${stamp(offsetMs)} ${body}`
    })
    .join('\n\n')
}

/**
 * The whole artifact.
 *
 * The header fields are the ones that make a record re-readable months later:
 * which company, which round, whether this was captured or reconstructed, how
 * long it ran, and what produced the text. `mode` earns its place because a
 * `debrief` is a memory five minutes old and a `live` is a recording — reading
 * one as the other is exactly the error this whole tool exists to stop.
 */
export function formatArtifact(
  header: LiveHeader,
  summary: LiveSummary | null,
  transcript: string,
): string {
  const date = header.startedAt.toISOString().slice(0, 10)
  const lines = [
    `# ${header.company} — ${header.round}, ${date}`,
    '',
    `mode: ${header.mode}`,
    `duration: ${formatDuration(header.durationMs)}`,
    `device: ${header.device}`,
    `model: ${header.model}`,
    '',
    '## Summary',
    '',
    summary === null
      ? '_No summary was generated. The transcript below is the record._'
      : stripSummaryHeading(summary.summary) || '_The model returned nothing for this section._',
    '',
    '## Open questions',
    '',
    // Named rather than left blank. This section is the model saying what one
    // side of a conversation cannot tell you, and its absence is a fact about
    // the artifact worth stating — a blank heading reads as "nothing was
    // missing", which is never true of half a conversation.
    summary?.openQuestions ??
      '_The model did not list what it could not determine. Treat the summary above as one side of the conversation._',
    '',
    '## Transcript (own microphone only)',
    '',
    transcript,
    '',
  ]
  return lines.join('\n')
}
