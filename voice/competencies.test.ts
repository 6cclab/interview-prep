import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findCompetency, listCompetencies, slugify } from './competencies'
import { PROBLEM_SLUG } from './context'

/** A fixture root with a competencies file and, optionally, a story bank. */
function root(competencies: string, stories?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'competencies-'))
  mkdirSync(join(dir, 'behavioral'), { recursive: true })
  writeFileSync(join(dir, 'behavioral/competencies.md'), competencies, 'utf8')
  if (stories !== undefined) {
    mkdirSync(join(dir, 'local'), { recursive: true })
    writeFileSync(join(dir, 'local/stories.md'), stories, 'utf8')
  }
  return dir
}

const FIXTURE = `# Behavioral Competencies

## Conflict / disagreement with a peer

Body that must not reach the picker.

## Failure

More body.

## Why you're leaving / why this company

Body.
`

describe('slugify', () => {
  it('produces a slug that passes the same guard as every other wire token', () => {
    for (const title of [
      'Conflict / disagreement with a peer',
      "Why you're leaving / why this company",
      'Escalating a systemic problem rather than patching the local instance',
      'Prioritisation and saying no',
    ]) {
      expect(slugify(title)).toMatch(PROBLEM_SLUG)
    }
  })

  it('collapses punctuation and never leaves a leading or trailing dash', () => {
    expect(slugify('Conflict / disagreement with a peer')).toBe('conflict-disagreement-with-a-peer')
    expect(slugify("Why you're leaving / why this company")).toBe('why-you-re-leaving-why-this-company')
    expect(slugify('  Failure!  ')).toBe('failure')
  })
})

describe('listCompetencies', () => {
  it('lists the headings, and only the headings', () => {
    const listed = listCompetencies(root(FIXTURE), null)
    expect(listed.map((c) => c.title)).toEqual([
      'Conflict / disagreement with a peer',
      'Failure',
      "Why you're leaving / why this company",
    ])
    // The bodies are the substance of the competency; the picker needs names.
    expect(JSON.stringify(listed)).not.toContain('must not reach the picker')
  })

  it('reports which competencies have a story and which do not', () => {
    const listed = listCompetencies(root(FIXTURE, '# Stories\n\n## Failure\n\nSomething.\n'), null)
    expect(listed.find((c) => c.title === 'Failure')?.hasStory).toBe(true)
    expect(listed.find((c) => c.title === 'Conflict / disagreement with a peer')?.hasStory).toBe(false)
  })

  it('treats a missing story bank as no stories rather than an error', () => {
    expect(listCompetencies(root(FIXTURE), null).every((c) => c.hasStory === false)).toBe(true)
  })

  // The real file, so authoring a competency whose heading slugifies to
  // something unusable breaks this test rather than the picker.
  it('every real competency has a usable, unique slug', () => {
    const listed = listCompetencies(process.cwd(), null)
    expect(listed.length).toBeGreaterThan(0)
    for (const c of listed) expect(c.slug).toMatch(PROBLEM_SLUG)
    expect(new Set(listed.map((c) => c.slug)).size).toBe(listed.length)
  })
})

describe('findCompetency', () => {
  it('resolves a slug to the authored title', () => {
    expect(findCompetency(root(FIXTURE), null, 'conflict-disagreement-with-a-peer')?.title).toBe(
      'Conflict / disagreement with a peer',
    )
  })

  it('returns null for an unknown slug rather than guessing', () => {
    expect(findCompetency(root(FIXTURE), null, 'teamwork')).toBeNull()
  })

  // Resolution goes through the file, so a slug is never reconstructed into a
  // title — a collision would surface as a duplicate entry, not a wrong drill.
  it('round-trips every real competency', () => {
    for (const c of listCompetencies(process.cwd(), null)) {
      expect(findCompetency(process.cwd(), null, c.slug)?.title).toBe(c.title)
    }
  })
})
