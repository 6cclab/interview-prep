import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../test-utils/random'
import { WordDictionary } from './solution'

describe('WordDictionary — correctness', () => {
  it('returns false when nothing has been added yet', () => {
    const d = new WordDictionary()
    expect(d.search('bad')).toBe(false)
  })

  it('the canonical sequence', () => {
    const d = new WordDictionary()
    d.addWord('bad')
    d.addWord('dad')
    d.addWord('mad')

    expect(d.search('pad')).toBe(false)
    expect(d.search('bad')).toBe(true)
    expect(d.search('.ad')).toBe(true)
    expect(d.search('b..')).toBe(true)
  })

  it('matches an exact word', () => {
    const d = new WordDictionary()
    d.addWord('hello')
    expect(d.search('hello')).toBe(true)
  })

  it('rejects a query shorter than any stored word', () => {
    const d = new WordDictionary()
    d.addWord('hello')
    expect(d.search('hell')).toBe(false)
  })

  // A common bug: matching up to the query's length and calling it a hit
  // even though a stored word continues past that point (or vice versa).
  // Length must match exactly, not just as a prefix.
  it('rejects a query longer than any stored word, even as a prefix match', () => {
    const d = new WordDictionary()
    d.addWord('hell')
    expect(d.search('hello')).toBe(false)
  })

  it('matches when every character of the query is a dot at a stored length', () => {
    const d = new WordDictionary()
    d.addWord('cat')
    expect(d.search('...')).toBe(true)
  })

  it('an all-dot query at a length nothing was stored for still fails', () => {
    const d = new WordDictionary()
    d.addWord('cat')
    d.addWord('doggo')
    expect(d.search('....')).toBe(false)
  })

  it('tolerates duplicate addWord calls for the same word', () => {
    const d = new WordDictionary()
    d.addWord('echo')
    d.addWord('echo')
    d.addWord('echo')
    expect(d.search('echo')).toBe(true)
    expect(d.search('ech.')).toBe(true)
  })

  it('handles single-character words and queries', () => {
    const d = new WordDictionary()
    d.addWord('a')
    expect(d.search('a')).toBe(true)
    expect(d.search('.')).toBe(true)
    expect(d.search('b')).toBe(false)
  })

  it('a partial-dot query only matches a stored word at the right length', () => {
    const d = new WordDictionary()
    d.addWord('bat')
    d.addWord('batman')
    expect(d.search('ba.')).toBe(true)
    expect(d.search('ba....')).toBe(true)
    expect(d.search('ba..')).toBe(false)
  })
})

describe('WordDictionary — scale', () => {
  /**
   * A brute force that stores every added word in a list and, on each
   * search, walks the whole list comparing the query against each stored
   * word (whether via regex or a manual char-by-char loop) does
   * O(words * length) work per query. To make that actually expensive in
   * practice — not just in theory — most of the words below share a long
   * common prefix, so a naive per-word comparison can't cheaply bail out
   * after one or two characters; it has to walk deep into the string for
   * nearly every stored word before it can tell a match from a near-miss.
   * The reference approach only pays for the characters the query itself
   * specifies, so it isn't affected by how much the stored words resemble
   * each other.
   *
   * All-dots queries are deliberately kept RARE in this fixture. Even the
   * intended approach has to explore broadly for a query with no fixed
   * characters at all — that's an inherent worst case, not a brute-force
   * artifact — so making all-dots queries the majority would blur the very
   * gap this test exists to measure. Mostly-exact / low-dot-density queries
   * are where the intended approach wins biggest, so they dominate here.
   */
  const SEED = 0x5ca1ab1e
  const rand = mulberry32(SEED)

  const SHARED_PREFIX = 'a'.repeat(15)
  const SUFFIX_LEN = 5
  const WORD_COUNT = 30_000
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

  function randomSuffix(): string {
    let s = ''
    for (let i = 0; i < SUFFIX_LEN; i++) {
      s += ALPHABET[Math.floor(rand() * 26)]!
    }
    return s
  }

  const dict = new WordDictionary()
  const insertedWords: string[] = []
  const insertedSuffixes = new Set<string>()

  for (let i = 0; i < WORD_COUNT; i++) {
    const suffix = randomSuffix()
    insertedSuffixes.add(suffix)
    const word = SHARED_PREFIX + suffix
    insertedWords.push(word)
    dict.addWord(word)
  }

  // Also seed in a handful of totally unrelated short words so the corpus
  // isn't 100% homogeneous in length/shape.
  const oddballs = ['a', 'zz', 'jazz', 'quorum', 'xylophone']
  for (const w of oddballs) dict.addWord(w)

  function unusedSuffix(): string {
    let s = randomSuffix()
    while (insertedSuffixes.has(s)) s = randomSuffix()
    return s
  }

  type Query = { word: string; expected: boolean }
  const queries: Query[] = []

  // Exact-match queries against words we know are present (dot density 0).
  for (let i = 0; i < 2400; i++) {
    const idx = Math.floor(rand() * insertedWords.length)
    queries.push({ word: insertedWords[idx]!, expected: true })
  }

  // Same-prefix queries with a suffix we know was never inserted — false,
  // but still forces a deep character-by-character comparison against most
  // of the corpus for any brute-force scan.
  for (let i = 0; i < 2400; i++) {
    queries.push({ word: SHARED_PREFIX + unusedSuffix(), expected: false })
  }

  // Low-dot-density queries built from a known word by masking one or two
  // of its trailing characters with '.'. True by construction: the word we
  // started from still matches once those positions are wildcarded.
  for (let i = 0; i < 2400; i++) {
    const idx = Math.floor(rand() * insertedWords.length)
    const chars = insertedWords[idx]!.split('')
    const maskCount = 1 + Math.floor(rand() * 2)
    for (let m = 0; m < maskCount; m++) {
      const pos = SHARED_PREFIX.length + Math.floor(rand() * SUFFIX_LEN)
      chars[pos] = '.'
    }
    queries.push({ word: chars.join(''), expected: true })
  }

  // Rare all-dots queries. One length has stored words (matches by
  // construction); one length was never inserted (fails by construction).
  // Kept to a small handful on purpose: even the intended approach cannot
  // avoid exploring broadly for a query with no fixed characters, so a large
  // batch of these would dominate total runtime and defeat the point of this
  // fixture, which is to show where the intended approach wins big.
  const insertedLength = SHARED_PREFIX.length + SUFFIX_LEN
  const neverInsertedLength = insertedLength + 3
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) {
      queries.push({ word: '.'.repeat(insertedLength), expected: true })
    } else {
      queries.push({ word: '.'.repeat(neverInsertedLength), expected: false })
    }
  }

  it(
    `finishes well within budget across ${queries.length} queries against ` +
      `${WORD_COUNT} inserted words sharing a long common prefix`,
    () => {
      // Time only the searches themselves, not the assertion machinery below
      // — matcher overhead across thousands of calls would otherwise swamp
      // the signal this test is actually after.
      const results: boolean[] = new Array(queries.length)
      const t0 = performance.now()

      for (let i = 0; i < queries.length; i++) {
        results[i] = dict.search(queries[i]!.word)
      }

      const elapsed = performance.now() - t0
      expect(elapsed).toBeLessThan(2000)

      for (let i = 0; i < queries.length; i++) {
        expect(results[i]).toBe(queries[i]!.expected)
      }
    },
  )
})
