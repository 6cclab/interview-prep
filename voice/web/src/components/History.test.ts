import { describe, it, expect } from 'vitest'
import { firstSentence } from './History'

/**
 * The collapsed note line.
 *
 * The redesign's whole claim is that every row is one line — a 400-word note
 * used to make one row ~600px tall and bury the eight rows around it. The
 * preview has to be the part of the note written to be read alone, which in
 * this log is the opening sentence.
 *
 * What it must never do is *change* the note. The log's notes carry meaning in
 * their markup: `~~struck~~` is a retracted claim and `**bold**` is a
 * correction, both of which the file's preamble treats as part of the record.
 * Stripping them for tidiness would render a withdrawn statement as a live one.
 */
describe('firstSentence', () => {
  it('takes the opening sentence of a multi-sentence note', () => {
    expect(firstSentence('Solved with help. Second attempt at this problem.')).toBe('Solved with help.')
  })

  it('keeps a single-sentence note whole', () => {
    expect(firstSentence('Self-directed re-solve, third recorded attempt.')).toBe(
      'Self-directed re-solve, third recorded attempt.'
    )
  })

  it('returns a note with no sentence break unchanged', () => {
    expect(firstSentence('no terminator here')).toBe('no terminator here')
  })

  it('handles an empty note', () => {
    expect(firstSentence('')).toBe('')
    expect(firstSentence('   ')).toBe('')
  })

  it('does not split on a decimal point or a version number', () => {
    expect(firstSentence('Ran in 2.5s against a 2.00s budget. Next line.')).toBe(
      'Ran in 2.5s against a 2.00s budget.'
    )
  })

  it('preserves markdown emphasis verbatim — it carries meaning in this log', () => {
    expect(firstSentence('**Real interview, not a drill.** Hints column is n/a.')).toBe(
      '**Real interview, not a drill.**'
    )
  })

  it('preserves a strikethrough, which marks a retracted claim', () => {
    expect(firstSentence('~~identified min-heap-of-size-k~~ but stopped. More detail.')).toBe(
      '~~identified min-heap-of-size-k~~ but stopped.'
    )
  })

  it('accepts a question or exclamation as a sentence end', () => {
    expect(firstSentence('Why did this pass? Because the fixture was wrong.')).toBe('Why did this pass?')
  })
})
