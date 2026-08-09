import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transcriptionPrompt, vocabularyFor } from './vocabulary'
import type { Track } from './context'

const REPO = join(import.meta.dirname, '..')
const TRACKS: Track[] = ['mock', 'design', 'coding']

/**
 * Every pattern directory under `problems/`, read from disk rather than copied.
 *
 * The point of reading it: adding a pattern must be able to break this test. A
 * hardcoded list would go stale the moment someone authors a new pattern, and the
 * failure would be silent — a vocabulary term that has quietly become a spoiler.
 */
function patternNames(): string[] {
  return readdirSync(join(REPO, 'problems'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/** `two-pointers` also as `two pointers`, since that is how it would be spoken. */
function forbiddenPhrases(): string[] {
  return patternNames().flatMap((slug) => [slug, slug.replace(/-/g, ' ')])
}

describe('the pattern is never offered to the decoder', () => {
  // A coding problem's pattern IS its answer, and whisper hallucinates prompt
  // content into output on short or silent audio — so a term list containing
  // "monotonic stack" could plant the answer in his own transcript.
  it('has no pattern name in the coding vocabulary', () => {
    const prompt = transcriptionPrompt('coding').toLowerCase()
    const leaked = forbiddenPhrases().filter((phrase) => prompt.includes(phrase.toLowerCase()))
    expect(leaked).toEqual([])
  })

  // Not just coding: the same whisper process transcribes every track, and a
  // design session's prompt has no business carrying a coding answer either.
  it.each(TRACKS)('has no pattern name in the %s vocabulary', (track) => {
    const prompt = transcriptionPrompt(track).toLowerCase()
    const leaked = forbiddenPhrases().filter((phrase) => prompt.includes(phrase.toLowerCase()))
    expect(leaked).toEqual([])
  })

  // Proves the guard can actually fire, rather than passing because the phrase
  // list is empty or the matching is broken.
  it('would catch a pattern name if one were added', () => {
    const phrases = forbiddenPhrases()
    expect(phrases.length).toBeGreaterThan(10)
    const pretend = `${transcriptionPrompt('coding')} ${phrases[0]}`.toLowerCase()
    expect(phrases.filter((phrase) => pretend.includes(phrase.toLowerCase()))).not.toEqual([])
  })
})

describe('vocabularyFor', () => {
  // The measured failure: a real transcript recorded "O of n" as "on" and "N" as
  // "M", and the interviewer marked him down for the second one.
  it('covers the complexity notation that was actually misheard', () => {
    for (const track of TRACKS) {
      const terms = vocabularyFor(track)
      expect(terms).toContain('O of n')
      expect(terms).toContain('O of one')
      expect(terms).toContain('O of n squared')
    }
  })

  // Spoken, not symbolic: the prompt biases speech decoding, so "oh of en" is
  // what reaches the microphone, not "O(n)".
  it('spells notation the way it is spoken rather than written', () => {
    const prompt = transcriptionPrompt('coding')
    expect(prompt).not.toContain('O(n)')
    expect(prompt).not.toContain('O(1)')
  })

  it('gives the design track its domain terms', () => {
    expect(vocabularyFor('design')).toContain('consistent hashing')
    expect(vocabularyFor('design')).toContain('quorum')
  })

  // Design vocabulary on a coding drill is noise at best; at worst it biases the
  // decoder toward words he is not saying.
  it('does not give design terms to the other tracks', () => {
    for (const track of ['mock', 'coding'] as const) {
      expect(vocabularyFor(track)).not.toContain('consistent hashing')
      expect(vocabularyFor(track)).not.toContain('sharding')
    }
  })

  it('has no duplicate terms', () => {
    for (const track of TRACKS) {
      const terms = vocabularyFor(track)
      expect(new Set(terms).size).toBe(terms.length)
    }
  })

  // whisper truncates the initial prompt at n_text_ctx/2 tokens. Nowhere near
  // that here, but a list that grows unbounded would silently start dropping its
  // tail, and the dropped end would be the design terms.
  it('stays far short of any prompt length whisper would truncate', () => {
    for (const track of TRACKS) {
      expect(transcriptionPrompt(track).length).toBeLessThan(1000)
    }
  })
})
