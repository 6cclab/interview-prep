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
      'local/designs/rate-limiter-live-2026-08-07.md',
    )
  })

  it('puts a mock session under local/', () => {
    expect(sessionPath('mock', new Date('2026-08-07T10:00:00Z'))).toBe(
      'local/mock-2026-08-07.md',
    )
  })
})

describe('writeSession', () => {
  it('creates missing parent directories', () => {
    writeSession(root, 'local/designs/rate-limiter-live-2026-08-07.md', 'BODY')
    expect(
      readFileSync(join(root, 'local/designs/rate-limiter-live-2026-08-07.md'), 'utf8'),
    ).toBe('BODY')
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
})
