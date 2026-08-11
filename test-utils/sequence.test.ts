import { describe, expect, it } from 'vitest'
import { firstCharDifference, firstDifference } from './sequence'

describe('firstDifference', () => {
  it('returns null for identical sequences', () => {
    expect(firstDifference([1, 2, 3], [1, 2, 3])).toBeNull()
    expect(firstDifference([], [])).toBeNull()
  })

  it('reports a length mismatch without printing either sequence', () => {
    const message = firstDifference([1, 2], [1, 2, 3])!
    expect(message).toBe('length 2, expected 3')
  })

  it('names the index of the first divergence', () => {
    expect(firstDifference(['a', 'b', 'x'], ['a', 'b', 'c'])).toContain('index 2')
  })

  it('reports the first divergence, not a later one', () => {
    const message = firstDifference([9, 1, 9], [0, 1, 0])!
    expect(message).toContain('index 0')
    expect(message).not.toContain('index 2')
  })

  // The whole point: the message stays short however long the inputs are.
  it('stays compact on a 100k mismatch', () => {
    const expected = Array.from({ length: 100_000 }, (_, i) => i % 10)
    const actual = [...expected]
    actual[50_000] = 7
    const message = firstDifference(actual, expected)!

    expect(message).toContain('index 50000')
    // A full diff here would be hundreds of kilobytes. A few hundred characters
    // is the difference between a readable suite and an unreadable one.
    expect(message.length).toBeLessThan(400)
  })

  it('elides with ellipses so a window is not mistaken for the whole sequence', () => {
    const message = firstDifference([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0])!
    expect(message).toContain('…')
  })

  it('does not claim an ellipsis at a boundary it did not truncate', () => {
    const message = firstDifference([1, 9], [1, 0])!
    expect(message).not.toContain('…')
  })
})

describe('firstCharDifference', () => {
  it('returns null for equal strings', () => {
    expect(firstCharDifference('abc', 'abc')).toBeNull()
  })

  it('names the index of the first differing character', () => {
    expect(firstCharDifference('abc', 'abd')).toContain('index 2')
  })
})
