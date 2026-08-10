import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendStoryLog,
  formatSession,
  sessionPath,
  splitTrailer,
  writeSession,
  type Entry,
} from './transcript'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-transcript-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const TRAILER = [
  'That result never landed. Cut the middle minute.',
  '',
  '```story-log',
  'competency: Conflict',
  'story: Redis migration',
  'worked: named the tradeoff out loud',
  'fix: no number in the result',
  '```',
].join('\n')

describe('splitTrailer', () => {
  it('strips the trailer from the spoken text', () => {
    expect(splitTrailer(TRAILER).spoken).toBe(
      'That result never landed. Cut the middle minute.',
    )
  })

  it('parses the trailer fields', () => {
    expect(splitTrailer(TRAILER).log).toEqual({
      competency: 'Conflict',
      story: 'Redis migration',
      worked: 'named the tradeoff out loud',
      fix: 'no number in the result',
    })
  })

  it('returns a null log when there is no trailer', () => {
    expect(splitTrailer('Just a question.')).toEqual({
      spoken: 'Just a question.',
      log: null,
    })
  })

  it('returns a null log when the trailer is missing a field', () => {
    const partial = '```story-log\ncompetency: Conflict\n```'
    expect(splitTrailer(partial).log).toBeNull()
  })

  it('strips every story-log block, keeping only the first for parsing', () => {
    const retried = [
      'That result never landed. Cut the middle minute.',
      '',
      '```story-log',
      'competency: Conflict',
      'story: Redis migration',
      'worked: named the tradeoff out loud',
      'fix: no number in the result',
      '```',
      '',
      '```story-log',
      'competency: Ambiguity',
      'story: something else',
      'worked: unclear',
      'fix: unclear',
      '```',
    ].join('\n')
    const result = splitTrailer(retried)
    expect(result.spoken).not.toContain('```')
    expect(result.spoken).not.toContain('competency:')
    expect(result.spoken).toBe('That result never landed. Cut the middle minute.')
    expect(result.log).toEqual({
      competency: 'Conflict',
      story: 'Redis migration',
      worked: 'named the tradeoff out loud',
      fix: 'no number in the result',
    })
  })

  it('suppresses an unclosed trailer fence from spoken text', () => {
    const truncated = [
      'That result never landed. Cut the middle minute.',
      '',
      '```story-log',
      'competency: Conflict',
      'story: Redis migration',
    ].join('\n')
    const result = splitTrailer(truncated)
    expect(result.spoken).toBe('That result never landed. Cut the middle minute.')
    expect(result.log).toBeNull()
  })

  it('keeps prose before and after a well-formed trailer', () => {
    const wrapped = [
      'Opening remark.',
      '',
      '```story-log',
      'competency: Conflict',
      'story: Redis migration',
      'worked: named the tradeoff out loud',
      'fix: no number in the result',
      '```',
      '',
      'Closing remark.',
    ].join('\n')
    const result = splitTrailer(wrapped)
    expect(result.spoken).toContain('Opening remark.')
    expect(result.spoken).toContain('Closing remark.')
    expect(result.spoken).not.toContain('```')
  })

  it('parses a field value that itself contains a colon', () => {
    const colonValue = [
      'Some remark.',
      '',
      '```story-log',
      'competency: Conflict',
      'story: Redis: the migration',
      'worked: named the tradeoff out loud',
      'fix: no number in the result',
      '```',
    ].join('\n')
    expect(splitTrailer(colonValue).log).toEqual({
      competency: 'Conflict',
      story: 'Redis: the migration',
      worked: 'named the tradeoff out loud',
      fix: 'no number in the result',
    })
  })
})

describe('formatSession', () => {
  it('labels each speaker and stamps elapsed time', () => {
    const startedAt = new Date('2026-08-07T10:00:00Z')
    const body = formatSession(
      [
        { speaker: 'interviewer', text: 'What are we optimising for?', at: 0 },
        { speaker: 'andre', text: 'Read latency.', at: 95_000 },
      ],
      startedAt,
    )
    expect(body).toContain('**Interviewer** [00:00]')
    expect(body).toContain('**Andre** [01:35]')
    expect(body).toContain('Read latency.')
  })
})

describe('sessionPath', () => {
  it('puts a design session where design.md says it goes', () => {
    expect(sessionPath('design', new Date('2026-08-07T10:00:00Z'), 'rate-limiter')).toBe(
      'local/designs/rate-limiter-live-2026-08-07-1000.md',
    )
  })

  it('puts a mock session under local/', () => {
    expect(sessionPath('mock', new Date('2026-08-07T10:00:00Z'))).toBe(
      'local/mock-2026-08-07-1000.md',
    )
  })

  // The name used to be the date alone, so a second drill on the same day
  // resolved to the same path — and `writeSession` overwrites, so it destroyed
  // the first one's transcript. Both tracks are named the same way and both
  // had the bug.
  it.each([
    ['mock', undefined],
    ['design', 'rate-limiter'],
  ] as const)('gives two %s sessions on the same day different paths', (track, problem) => {
    const morning = sessionPath(track, new Date('2026-08-07T10:00:00Z'), problem)
    const evening = sessionPath(track, new Date('2026-08-07T19:32:00Z'), problem)
    expect(morning).not.toBe(evening)
  })
})

describe('writeSession', () => {
  it('creates missing parent directories', () => {
    writeSession(root, 'local/designs/rate-limiter-live-2026-08-07.md', 'BODY')
    expect(
      readFileSync(join(root, 'local/designs/rate-limiter-live-2026-08-07.md'), 'utf8'),
    ).toBe('BODY')
  })

  it('returns the path it wrote', () => {
    expect(writeSession(root, 'local/mock-2026-08-07-1000.md', 'BODY')).toBe('local/mock-2026-08-07-1000.md')
  })

  // `local/` is gitignored, so an overwritten transcript is gone for good. This
  // is the backstop behind the unique naming in `sessionPath`, not a substitute
  // for it.
  it('never overwrites an existing transcript, and reports the path it used instead', () => {
    writeSession(root, 'local/mock-2026-08-07-1000.md', 'FIRST')
    const second = writeSession(root, 'local/mock-2026-08-07-1000.md', 'SECOND')
    expect(second).toBe('local/mock-2026-08-07-1000-2.md')
    expect(readFileSync(join(root, 'local/mock-2026-08-07-1000.md'), 'utf8')).toBe('FIRST')
    expect(readFileSync(join(root, 'local/mock-2026-08-07-1000-2.md'), 'utf8')).toBe('SECOND')

    const third = writeSession(root, 'local/mock-2026-08-07-1000.md', 'THIRD')
    expect(third).toBe('local/mock-2026-08-07-1000-3.md')
  })

  // A dotfile's leading dot is not an extension. Not reachable from any current
  // caller, but this function's whole job is protecting data that cannot be
  // recovered, so it should not have a shape that quietly produces nonsense.
  it('suffixes a name with no extension, and a dotfile, without mangling it', () => {
    writeSession(root, 'local/notes', 'FIRST')
    expect(writeSession(root, 'local/notes', 'SECOND')).toBe('local/notes-2')
    writeSession(root, 'local/.hidden', 'FIRST')
    expect(writeSession(root, 'local/.hidden', 'SECOND')).toBe('local/.hidden-2')
  })
})

describe('appendStoryLog', () => {
  const log = {
    competency: 'Conflict',
    story: 'Redis migration',
    worked: 'named the tradeoff',
    fix: 'no number in the result',
  }

  it('creates the story bank when it does not exist', () => {
    appendStoryLog(root, log)
    expect(readFileSync(join(root, 'local/stories.md'), 'utf8')).toContain('## Conflict')
  })

  it('appends without clobbering existing stories', () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/stories.md'), '## Ambiguity\n\nexisting\n')
    appendStoryLog(root, log)
    const body = readFileSync(join(root, 'local/stories.md'), 'utf8')
    expect(body).toContain('## Ambiguity')
    expect(body).toContain('## Conflict')
  })

  it('does not open a fresh file with a leading blank line', () => {
    appendStoryLog(root, log)
    const body = readFileSync(join(root, 'local/stories.md'), 'utf8')
    expect(body.startsWith('\n')).toBe(false)
  })

  it('keeps entries separated when appending to an existing file', () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/stories.md'), '## Ambiguity\n\nexisting\n')
    appendStoryLog(root, log)
    const body = readFileSync(join(root, 'local/stories.md'), 'utf8')
    expect(body).not.toContain('existing\n## Conflict')
    expect(body).toContain('existing\n\n## Conflict')
  })
})

/**
 * The transport line.
 *
 * A drill on 2026-08-10 read wrong — the interviewer conducted it in the third
 * person — and nothing in the transcript said which backend or model had
 * produced it, so the diagnosis rested on comparing the file's timestamp against
 * a commit that changed the default model. A transcript is the only artifact a
 * drill leaves; it should not need corroborating evidence from git.
 */
describe('formatSession records what conducted the session', () => {
  const entries: Entry[] = [{ speaker: 'interviewer', text: 'Go ahead.', at: 0 }]

  it('names the backend and model under the heading', () => {
    const body = formatSession(entries, new Date('2026-08-10T18:54:30.000Z'), 'cli / claude-sonnet-5')
    expect(body).toContain('# Voice session — 2026-08-10T18:54:30.000Z')
    expect(body).toContain('Interviewer: cli / claude-sonnet-5')
  })

  // `cli.ts` passes nothing, and a header line asserting an unknown transport
  // would be worse than no line at all.
  it('omits the line rather than guessing when it is not given', () => {
    expect(formatSession(entries, new Date('2026-08-10T18:54:30.000Z'))).not.toContain('Interviewer:')
  })
})
