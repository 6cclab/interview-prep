import { describe, expect, it } from 'vitest'
import { SentenceBuffer } from './chunk'

function feed(deltas: string[]): string[] {
  const buffer = new SentenceBuffer()
  const out = deltas.flatMap((delta) => buffer.push(delta))
  return [...out, ...buffer.flush()]
}

describe('SentenceBuffer', () => {
  it('emits a sentence as soon as it is terminated', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('What are we optimising for?')).toEqual([
      'What are we optimising for?',
    ])
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
})
