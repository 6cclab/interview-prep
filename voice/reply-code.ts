/**
 * Which fenced blocks in an interviewer's reply are *shown* and which are
 * swallowed.
 *
 * Two different kinds of fenced block reach this codebase, and conflating them
 * is the bug this module exists to make impossible:
 *
 * - **Code**, which the pairing coach emits so it can show a snippet instead of
 *   dictating one. It must reach the transcript and the browser, and must never
 *   reach the speech synthesiser — a spoken code block is unusable, which is
 *   exactly why `voice/coach.ts` used to forbid code outright.
 * - **Log trailers** (`drill-log`, `story-log`), which are machine-read into
 *   `local/` and must reach neither. `voice/http-server.ts` deliberately keeps
 *   `interviewer.lastRaw()` away from the browser for this reason, and the
 *   coding track's trailer carries the verdict — leaking it into the pane would
 *   hand him the answer to the drill he is still sitting in.
 *
 * So the tag is an **allowlist, not a denylist**. A trailer kind added later is
 * hidden by default rather than shown by default, and getting that backwards is
 * silent: it looks fine until the day a new trailer appears in the pane.
 */

/**
 * Fence tags whose contents are code.
 *
 * The empty tag is included because a bare ``` fence is what a model reaches for
 * when it is not thinking about language tags, and every trailer this repo
 * defines is explicitly tagged — so a bare fence is code by elimination.
 */
const CODE_TAGS = new Set(['', 'ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript', 'json', 'text'])

export function isCodeTag(tag: string): boolean {
  return CODE_TAGS.has(tag.trim().toLowerCase())
}

/** Matches a fence opener and captures its tag, e.g. "```ts\n" -> "ts". */
const FENCE_OPEN = /```([^\n`]*)\n/

/**
 * Project a raw reply down to what may be *displayed* — in the transcript pane
 * and in the saved transcript file.
 *
 * Code fences survive intact, tag and all, because the pane renders markdown.
 * Every other fenced block is removed along with its fence.
 *
 * An **unterminated** block is treated by the same split. A truncated code fence
 * keeps what arrived: a half-written snippet is still readable, and its missing
 * close is visible on screen. A truncated trailer drops everything from the
 * fence onward, matching `voice/transcript.ts`'s rule that half a trailer is
 * worse than a missing one — here it would be worse still, since the fragment
 * would be rendered rather than parsed.
 */
export function displayText(raw: string): string {
  let out = ''
  let rest = raw

  for (;;) {
    const open = FENCE_OPEN.exec(rest)
    if (!open) {
      out += rest
      break
    }

    const tag = open[1]!
    const bodyAt = open.index + open[0].length
    out += rest.slice(0, open.index)

    const close = rest.indexOf('```', bodyAt)
    if (close === -1) {
      // Unterminated. Keep a code fence's partial body; drop a trailer's.
      if (isCodeTag(tag)) out += rest.slice(open.index)
      break
    }

    if (isCodeTag(tag)) out += rest.slice(open.index, close + 3)
    rest = rest.slice(close + 3)
  }

  return out.trim()
}

/**
 * Project a raw reply down to what may be *spoken*.
 *
 * Simpler than `displayText`, because the synthesiser wants none of it: every
 * fenced block is removed regardless of tag. Code is unusable read aloud, and a
 * trailer read aloud is the bug `voice/interviewer.ts` was written to prevent.
 *
 * An unterminated fence truncates the rest, since mid-stream we cannot yet know
 * the tag or where the block ends. That is not a loss: this runs again on every
 * delta, and the prose after the closing fence reappears as soon as it arrives.
 * That is what lets the coach put a snippet in the *middle* of a turn and keep
 * talking afterwards, rather than being cut off for the rest of it.
 *
 * Whitespace is deliberately **not** trimmed. The caller tracks how much of this
 * projection it has already spoken by length, so the offsets have to stay
 * stable as the reply grows.
 */
export function speechText(raw: string): string {
  let out = ''
  let rest = raw

  for (;;) {
    const open = FENCE_OPEN.exec(rest)
    if (!open) {
      // A backtick run with no newline yet is an opener still on the wire. Stop
      // there rather than speaking the backticks.
      const bare = rest.indexOf('```')
      out += bare === -1 ? rest : rest.slice(0, bare)
      break
    }

    out += rest.slice(0, open.index)
    const close = rest.indexOf('```', open.index + open[0].length)
    if (close === -1) break
    rest = rest.slice(close + 3)
  }

  return out
}

/** Whether a reply carries a code block, and so needs `displayText` at all. */
export function hasCodeBlock(raw: string): boolean {
  let rest = raw
  for (;;) {
    const open = FENCE_OPEN.exec(rest)
    if (!open) return false
    if (isCodeTag(open[1]!)) return true
    const close = rest.indexOf('```', open.index + open[0].length)
    if (close === -1) return false
    rest = rest.slice(close + 3)
  }
}
