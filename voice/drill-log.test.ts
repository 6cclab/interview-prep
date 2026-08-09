import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseClock, parseDrillLog, readDrillLog, splitRow, summarise } from './drill-log'
import { appendDrillLog } from './transcript'

const HEADER = [
  '| Date | Problem | Pattern | Solved | Hints | Time | Note |',
  '|------|---------|---------|--------|-------|------|------|',
].join('\n')

function log(...rows: string[]): string {
  return `# Drill Log\n\nSome preamble prose.\n\n${HEADER}\n${rows.join('\n')}\n`
}

describe('splitRow', () => {
  it('trims cells and drops the leading and trailing pipes', () => {
    expect(splitRow('| a |  b  | c |')).toEqual(['a', 'b', 'c'])
  })

  // appendDrillLog escapes pipes in the note; this is the other half of that.
  it('unescapes an escaped pipe rather than splitting on it', () => {
    expect(splitRow('| a | one \\| two |')).toEqual(['a', 'one | two'])
  })
})

describe('parseClock', () => {
  it.each([
    ['0:00', 0],
    ['4:12', 252_000],
    ['45:00', 2_700_000],
    ['120:30', 7_230_000],
  ])('reads %s', (text, ms) => {
    expect(parseClock(text)).toBe(ms)
  })

  it.each(['', '4:60', '4', 'twelve', '4:1', '-1:00'])('rejects %j', (text) => {
    expect(parseClock(text)).toBeNull()
  })
})

describe('parseDrillLog', () => {
  it('reads a row', () => {
    const rows = parseDrillLog(log('| 2026-08-09 | contains-duplicate | hashmap-counting | yes | 1 | 04:12 | Shipped early. |'))
    expect(rows).toEqual([
      {
        date: '2026-08-09',
        problem: 'contains-duplicate',
        pattern: 'hashmap-counting',
        solved: true,
        hints: 1,
        elapsedMs: 252_000,
        note: 'Shipped early.',
      },
    ])
  })

  // The header and the |---| separator are skipped by shape, not by matching
  // their text, so a reworded header cannot start being parsed as data.
  it('skips the header, the separator and the prose', () => {
    expect(parseDrillLog(log())).toEqual([])
    expect(parseDrillLog('# Drill Log\n\nNo table at all.\n')).toEqual([])
  })

  it('returns newest first, whatever order the file is in', () => {
    const rows = parseDrillLog(
      log(
        '| 2026-08-01 | celebrity | elimination | no | 4 | 45:00 | Ran out of time. |',
        '| 2026-08-09 | sort-colors | in-place-array | yes | 0 | 08:30 | Clean. |',
      ),
    )
    expect(rows.map((row) => row.problem)).toEqual(['sort-colors', 'celebrity'])
  })

  // Only an explicit yes is a solve, matching splitDrillLog. A hand-written
  // "partly" must never inflate the count the screen reports.
  it.each(['no', 'partly', 'sort of', '', 'y'])('does not count %j as solved', (solved) => {
    const rows = parseDrillLog(log(`| 2026-08-09 | celebrity | elimination | ${solved} | 0 | 05:00 | n |`))
    expect(rows[0]!.solved).toBe(false)
  })

  it('counts yes case-insensitively', () => {
    expect(parseDrillLog(log('| 2026-08-09 | celebrity | elimination | Yes | 0 | 05:00 | n |'))[0]!.solved).toBe(true)
  })

  // One bad line must not blank the screen — this file is hand-edited, and
  // /review is told to annotate it.
  it('skips an unparseable row and keeps the rest', () => {
    const rows = parseDrillLog(
      log(
        '| not-a-date | celebrity | elimination | yes | 0 | 05:00 | n |',
        '| 2026-08-09 | sort-colors | in-place-array | yes | 0 | 08:30 | Fine. |',
        '| 2026-08-10 | Bad Slug! | x | yes | 0 | 01:00 | n |',
        '| 2026-08-11 | too | few | cells |',
      ),
    )
    expect(rows.map((row) => row.problem)).toEqual(['sort-colors'])
  })

  it('keeps a note containing a pipe intact', () => {
    const rows = parseDrillLog(log('| 2026-08-09 | celebrity | elimination | yes | 0 | 05:00 | a \\| b |'))
    expect(rows[0]!.note).toBe('a | b')
  })

  it('does not truncate a note whose pipe was never escaped', () => {
    const rows = parseDrillLog(log('| 2026-08-09 | celebrity | elimination | yes | 0 | 05:00 | a | b |'))
    expect(rows[0]!.note).toBe('a | b')
  })

  it.each(['9', '-1', '', 'two'])('clamps an out-of-range hint rung %j to 0', (hints) => {
    const rows = parseDrillLog(log(`| 2026-08-09 | celebrity | elimination | yes | ${hints} | 05:00 | n |`))
    expect(rows[0]!.hints).toBe(0)
  })

  it('survives a malformed time as zero rather than dropping the row', () => {
    const rows = parseDrillLog(log('| 2026-08-09 | celebrity | elimination | yes | 0 | ages | n |'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.elapsedMs).toBe(0)
  })
})

// The two halves have to agree, and only one of them existed until now.
describe('round trip with appendDrillLog', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voice-drill-log-'))
    mkdirSync(join(root, 'local'), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads back exactly what it wrote, pipes and all', () => {
    appendDrillLog(root, {
      startedAt: new Date('2026-08-09T19:25:00Z'),
      problem: 'contains-duplicate',
      pattern: 'hashmap-counting',
      solved: true,
      hints: 1,
      elapsedMs: 252_000,
      note: 'Split 0 from -0 | needed a nudge',
    })

    expect(readDrillLog(root)).toEqual([
      {
        date: '2026-08-09',
        problem: 'contains-duplicate',
        pattern: 'hashmap-counting',
        solved: true,
        hints: 1,
        elapsedMs: 252_000,
        note: 'Split 0 from -0 | needed a nudge',
      },
    ])
  })

  it('is an empty history when there is no log at all', () => {
    expect(readDrillLog(mkdtempSync(join(tmpdir(), 'voice-nolog-')))).toEqual([])
  })

  it('is an empty history for a log with only a header', () => {
    writeFileSync(join(root, 'local/drill-log.md'), log())
    expect(readDrillLog(root)).toEqual([])
  })
})

describe('summarise', () => {
  const rows = parseDrillLog(
    log(
      '| 2026-08-01 | celebrity | elimination | no | 4 | 45:00 | Ran out. |',
      '| 2026-08-02 | sort-colors | in-place-array | yes | 0 | 06:00 | Clean. |',
      '| 2026-08-03 | sort-colors | in-place-array | yes | 2 | 10:00 | Re-drill. |',
      '| 2026-08-04 | coin-change | dp-1d | yes | 0 | 14:00 | Clean. |',
    ),
  )

  // The log's own preamble: "a solve that took four hints is a different fact
  // from a cold solve, and the log is useless if it flattens them."
  it('reports cold solves separately from solves', () => {
    const summary = summarise(rows)
    expect(summary.solved).toBe(3)
    expect(summary.cold).toBe(2)
  })

  it('counts distinct problems, not attempts', () => {
    const summary = summarise(rows)
    expect(summary.attempts).toBe(4)
    expect(summary.problems).toBe(3)
  })

  // Median, not mean: one session that ran the full 45 minutes would drag a mean
  // away from anything typical at this sample size.
  it('takes the median of solved times only', () => {
    expect(summarise(rows).medianSolvedMs).toBe(600_000)
  })

  it('averages the middle two on an even count', () => {
    const even = rows.filter((row) => row.problem !== 'coin-change')
    expect(summarise(even).medianSolvedMs).toBe(480_000)
  })

  it('has no median when nothing is solved', () => {
    const none = parseDrillLog(log('| 2026-08-01 | celebrity | elimination | no | 4 | 45:00 | n |'))
    expect(summarise(none).medianSolvedMs).toBeNull()
  })

  it('is all zeroes for an empty history', () => {
    expect(summarise([])).toEqual({ attempts: 0, solved: 0, cold: 0, problems: 0, medianSolvedMs: null })
  })
})
