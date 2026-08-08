// Single-part abbreviations, which have no structure to recognise them by and so
// have to be listed. Multi-part initialisms (U.S., U.K., a.m., p.m., Ph.D.) are
// NOT listed — they are caught structurally by the INITIALISM_TAIL rule below,
// because a closed list of them can only ever be as complete as the last time
// someone thought to extend it, and the failure mode is the interviewer audibly
// stopping mid-sentence.
const ABBREVIATIONS = ['etc.', 'vs.', 'approx.', 'Dr.', 'Mr.', 'Ms.']

// The final period of a multi-part initialism: a lone letter that is itself
// preceded by a period. This deliberately does not match a lone letter preceded
// by a space — "go with option A." is a real sentence ending and must still
// split, whereas the "S." of "U.S." must not.
const INITIALISM_TAIL = /\.[A-Za-z]$/

function endsSentence(text: string, index: number): boolean {
  const char = text[index]
  if (char !== '.' && char !== '?' && char !== '!') return false

  if (char === '.') {
    const before = text[index - 1]
    const after = text[index + 1]
    // A decimal point: 99.9
    if (before && after && /\d/.test(before) && /\d/.test(after)) return false
    const head = text.slice(0, index + 1)
    if (ABBREVIATIONS.some((abbrev) => head.endsWith(abbrev))) return false
    // Note this reads the two characters before the period, not `head` — the
    // earlier periods of an initialism never fire on their own, because the
    // whitespace rule below already holds back a period followed by a letter.
    if (INITIALISM_TAIL.test(text.slice(Math.max(0, index - 2), index))) return false
  }

  // A terminator only ends a sentence when whitespace follows it. At the end
  // of the buffer there is no way yet to know whether more text is coming
  // (a digit that turns a period into a decimal, more dots, an abbreviation
  // letter, ...), so hold it back; push() will emit it once a later delta
  // confirms it with whitespace, and flush() resolves it once the stream is
  // genuinely over.
  const next = text[index + 1]
  return next !== undefined && /\s/.test(next)
}

/**
 * Above this many held-back characters, `push` gives up waiting for a terminator
 * and emits what it has. Nothing the interviewer says should come close: this is
 * roughly ten long sentences, so reaching it means no terminator is coming at all
 * (a model streaming a wall of prose, or a bug upstream). Without the cap, that
 * case grows `pending` for the whole session and speaks nothing until the stream
 * ends — the drill goes silent rather than degrading.
 */
const MAX_PENDING = 2000

/**
 * Accumulates streamed text deltas and emits complete sentences as soon as they
 * are terminated, so speech can begin before the model has finished generating.
 */
export class SentenceBuffer {
  private pending = ''

  push(delta: string): string[] {
    this.pending += delta
    const complete: string[] = []

    let start = 0
    for (let i = 0; i < this.pending.length; i++) {
      if (!endsSentence(this.pending, i)) continue
      const sentence = this.pending.slice(start, i + 1).trim()
      if (sentence) complete.push(sentence)
      start = i + 1
    }

    this.pending = this.pending.slice(start)

    if (this.pending.length > MAX_PENDING) {
      // Break at the last whitespace so the forced emission is at least whole
      // words; if there isn't any, the whole buffer is one unbroken token and
      // there is no better place to cut than all of it.
      const lastSpace = this.pending.lastIndexOf(' ')
      const cut = lastSpace > 0 ? lastSpace : this.pending.length
      const forced = this.pending.slice(0, cut).trim()
      if (forced) complete.push(forced)
      this.pending = this.pending.slice(cut)
    }

    return complete
  }

  flush(): string[] {
    const tail = this.pending.trim()
    this.pending = ''
    return tail ? [tail] : []
  }
}
