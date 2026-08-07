const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.', 'approx.', 'Dr.', 'Mr.', 'Ms.']

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
  }

  // A terminator only ends a sentence at end-of-buffer or before whitespace,
  // so "reads.The" mid-token is left alone until more deltas arrive.
  const next = text[index + 1]
  return next === undefined || /\s/.test(next)
}

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
    return complete
  }

  flush(): string[] {
    const tail = this.pending.trim()
    this.pending = ''
    return tail ? [tail] : []
  }
}
