import { describe, expect, it } from 'vitest'
import { SentenceBuffer } from './chunk'

function feed(deltas: string[]): string[] {
  const buffer = new SentenceBuffer()
  const out = deltas.flatMap((delta) => buffer.push(delta))
  return [...out, ...buffer.flush()]
}

describe('SentenceBuffer', () => {
  it('holds a terminated sentence back until the next delta confirms it', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('What are we optimising for?')).toEqual([])
  })

  it('emits the held sentence once following whitespace arrives', () => {
    const buffer = new SentenceBuffer()
    buffer.push('What are we optimising for?')
    expect(buffer.push(' Be specific.')).toEqual(['What are we optimising for?'])
  })

  it('holds an unterminated fragment back', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('What are we')).toEqual([])
  })

  it('reassembles a sentence split across deltas', () => {
    expect(feed(['What are ', 'we optimi', 'sing for?'])).toEqual([
      'What are we optimising for?',
    ])
  })

  it('splits multiple sentences in one delta', () => {
    expect(feed(['Start the clock. Say nothing else.'])).toEqual([
      'Start the clock.',
      'Say nothing else.',
    ])
  })

  it('flushes an unterminated tail', () => {
    expect(feed(['No trailing period'])).toEqual(['No trailing period'])
  })

  it('does not split inside a decimal', () => {
    expect(feed(['We serve 99.9 percent of reads.'])).toEqual([
      'We serve 99.9 percent of reads.',
    ])
  })

  it.each(['e.g.', 'i.e.', 'etc.', 'vs.'])('does not split after %s', (abbrev) => {
    expect(feed([`Pick a store, ${abbrev} Redis, and justify it.`])).toEqual([
      `Pick a store, ${abbrev} Redis, and justify it.`,
    ])
  })

  it('emits nothing for whitespace-only content', () => {
    expect(feed(['   ', '\n'])).toEqual([])
  })

  it('does not split a decimal across a delta boundary', () => {
    expect(feed(['We serve 99.', '9 percent of reads.'])).toEqual([
      'We serve 99.9 percent of reads.',
    ])
  })

  it('does not split an abbreviation across a delta boundary', () => {
    expect(feed(['The U.', 'S. government working.'])).toEqual([
      'The U.S. government working.',
    ])
  })

  it('does not split consecutive terminators across a delta boundary', () => {
    expect(feed(['Wait.', '.. Really?'])).toEqual(['Wait...', 'Really?'])
  })

  // Initialisms are recognised structurally, not from a list, so ones nobody
  // thought to enumerate hold together too. The visible failure of getting this
  // wrong is the interviewer stopping audibly mid-sentence.
  it.each(['U.S.', 'U.K.', 'a.m.', 'p.m.', 'Ph.D.'])('does not split after %s', (abbrev) => {
    expect(feed([`We shipped it in the ${abbrev} last year.`])).toEqual([
      `We shipped it in the ${abbrev} last year.`,
    ])
  })

  // The counterpart the structural rule must NOT swallow: a lone letter ending a
  // real sentence. This is why the rule requires a preceding period rather than
  // treating every isolated letter as an abbreviation.
  it('still splits a sentence that ends in a single letter', () => {
    expect(feed(['Go with option A. Justify it.'])).toEqual(['Go with option A.', 'Justify it.'])
  })

  it('emits held text once it grows past the cap rather than buffering forever', () => {
    const buffer = new SentenceBuffer()
    // No terminator anywhere: the un-capped buffer would hold all of this and
    // speak nothing until the stream ended.
    const out = Array.from({ length: 30 }, () => buffer.push('word '.repeat(20))).flat()
    expect(out.length).toBeGreaterThan(0)
    expect(out.join(' ')).not.toContain('  ')
    // Everything emitted plus everything still held must be exactly what went
    // in — a forced break may not drop or duplicate words.
    const words = [...out, ...buffer.flush()].join(' ').split(/\s+/).filter(Boolean)
    expect(words).toHaveLength(30 * 20)
  })

  it('does not force a break on ordinary sentence-length input', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('A fairly long question about tradeoffs, '.repeat(4))).toEqual([])
  })
})
