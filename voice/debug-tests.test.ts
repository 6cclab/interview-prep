import { describe, expect, it } from 'vitest'
import {
  classifyDebugFailures,
  debugVerdictCue,
  failedDebugTestsFromJson,
  runDebugTests,
  suiteFile,
  type DebugVerdict,
  type FailedDebugTest,
} from './debug-tests'

/**
 * The debugging verdict, which is the exercise.
 *
 * `debug.md`: "Green on `repro` alone means he patched the symptom. That is the
 * finding, and it is the whole point of the exercise — say it plainly rather than
 * congratulating a partial fix." Everything here is about that sentence being
 * mechanically true rather than left to the interviewer to notice.
 */

function failure(file: FailedDebugTest['file'], title: string): FailedDebugTest {
  return { file, suite: 'checkout', title }
}

describe('suiteFile', () => {
  it.each([
    ['debugging/loyalty-discount/repro.test.ts', 'repro'],
    ['/abs/path/debugging/loyalty-discount/invariant.test.ts', 'invariant'],
    ['debugging/loyalty-discount/src/other.test.ts', 'unknown'],
    ['', 'unknown'],
  ])('reads %j as %s', (path, expected) => {
    expect(suiteFile(path)).toBe(expected)
  })

  // The basename and nothing else. The path holds the exercise name, and
  // `debug.md` says not to display it — so it is discarded here, before a verdict
  // string exists that could carry it to a screen.
  it('keeps no part of the path but the file', () => {
    expect(suiteFile('debugging/loyalty-discount/repro.test.ts')).toBe('repro')
  })
})

describe('classifyDebugFailures', () => {
  it('calls both suites green the root cause', () => {
    expect(classifyDebugFailures([])).toEqual({ kind: 'root-cause' })
  })

  // The one that matters. A fix that turns repro green and leaves invariant red
  // must never be reported as progress.
  it('calls repro-green-invariant-red a symptom patch, not a partial pass', () => {
    const verdict = classifyDebugFailures([failure('invariant', 'holds across a mixed sequence')])
    expect(verdict.kind).toBe('symptom-patch')
    expect(verdict).toMatchObject({ failed: ['checkout > holds across a mixed sequence'] })
  })

  it('calls a still-red repro unfixed, whatever invariant did', () => {
    expect(classifyDebugFailures([failure('repro', 'assigns the discount')]).kind).toBe('unfixed')
    expect(
      classifyDebugFailures([failure('repro', 'assigns the discount'), failure('invariant', 'holds')]).kind,
    ).toBe('unfixed')
  })

  // The shipped state of every exercise: both red. It is where a drill starts, so
  // it has to read as "not yet", never as an error.
  it('reports the shipped both-red state as unfixed and lists both', () => {
    const verdict = classifyDebugFailures([failure('repro', 'a'), failure('invariant', 'b')])
    expect(verdict).toEqual({ kind: 'unfixed', failed: ['checkout > a', 'checkout > b'] })
  })

  // Reporting a stray suite as a verdict about his fix would be guessing.
  it('errors rather than guessing when the failures are from neither suite', () => {
    const verdict = classifyDebugFailures([failure('unknown', 'something else entirely')])
    expect(verdict.kind).toBe('errored')
    expect(verdict).toMatchObject({ message: expect.stringContaining('outside the exercise') })
  })

  // A failure with no enclosing describe still has to be nameable.
  it('names a test that has no suite', () => {
    const verdict = classifyDebugFailures([{ file: 'invariant', suite: '', title: 'bare test' }])
    expect(verdict).toMatchObject({ failed: ['bare test'] })
  })
})

describe('failedDebugTestsFromJson', () => {
  const report = JSON.stringify({
    testResults: [
      {
        name: '/repo/debugging/loyalty-discount/repro.test.ts',
        assertionResults: [
          { status: 'passed', title: 'passes', ancestorTitles: ['express checkout'] },
          { status: 'failed', title: 'assigns the discount', ancestorTitles: ['express checkout'] },
        ],
      },
      {
        name: '/repo/debugging/loyalty-discount/invariant.test.ts',
        assertionResults: [{ status: 'failed', title: 'holds', ancestorTitles: ['invariant', 'mixed'] }],
      },
    ],
  })

  it('keeps only failures, and records which file each came from', () => {
    expect(failedDebugTestsFromJson(report)).toEqual([
      { file: 'repro', suite: 'express checkout', title: 'assigns the discount' },
      { file: 'invariant', suite: 'invariant > mixed', title: 'holds' },
    ])
  })

  // `testResults[].name` is the only place the file appears, and the whole
  // classification turns on it — so a report shape that lost it must not silently
  // classify as something plausible.
  it('marks a file it cannot identify rather than assuming one', () => {
    const nameless = JSON.stringify({
      testResults: [{ assertionResults: [{ status: 'failed', title: 'x', ancestorTitles: [] }] }],
    })
    expect(failedDebugTestsFromJson(nameless)[0]!.file).toBe('unknown')
  })
})

describe('debugVerdictCue', () => {
  it('marks itself as an aside on every state, so it is never read out', () => {
    const verdicts: DebugVerdict[] = [
      { kind: 'root-cause' },
      { kind: 'symptom-patch', failed: ['a'] },
      { kind: 'unfixed', failed: ['a'] },
      { kind: 'errored', message: 'boom' },
    ]
    for (const verdict of verdicts) {
      expect(debugVerdictCue(verdict)).toMatch(/^\[Test result, for you only:/)
      expect(debugVerdictCue(verdict)).toMatch(/\]$/)
    }
  })

  // The cue supplies the *meaning*, not just the fact: an interviewer left to
  // interpret "repro passed, invariant failed" congratulates a partial fix about
  // as often as not, and debug.md says not to soften it.
  it('names a symptom patch as such and forbids softening it', () => {
    const cue = debugVerdictCue({ kind: 'symptom-patch', failed: ['checkout > holds'] })
    expect(cue).toContain('symptom patch')
    expect(cue).toMatch(/do not soften it/i)
    expect(cue).toMatch(/what the two failing paths have in common/)
    // Even here it must not point at the defect — that is rung 4, and the
    // interviewer does not have it.
    expect(cue).toMatch(/Do not name the file, the module or the cause yourself/)
  })

  it('does not call the root cause anything weaker', () => {
    const cue = debugVerdictCue({ kind: 'root-cause' })
    expect(cue).toContain('root cause, not a symptom patch')
    expect(cue).toMatch(/hypothesis/)
  })

  it('tells the interviewer not to hint when the symptom still reproduces', () => {
    expect(debugVerdictCue({ kind: 'unfixed', failed: ['a'] })).toMatch(/Do not hint at the cause/)
  })
})

describe('runDebugTests', () => {
  /** A vitest stand-in: writes the report a real run would have written. */
  function reports(entries: { file: string; failed: string[] }[]) {
    return async (_args: string[], _cwd: string, reportPath: string) => {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        reportPath,
        JSON.stringify({
          testResults: entries.map((entry) => ({
            name: `/repo/debugging/loyalty-discount/${entry.file}`,
            assertionResults: entry.failed.map((title) => ({
              status: 'failed',
              title,
              ancestorTitles: ['checkout'],
            })),
          })),
        }),
      )
    }
  }

  it('runs both suite files by path, never by exercise name', async () => {
    let seen: string[] = []
    await runDebugTests({
      root: '/repo',
      exercise: 'loyalty-discount',
      runner: async (args, _cwd, reportPath) => {
        seen = args
        await reports([])(args, _cwd, reportPath)
      },
    })
    expect(seen).toContain('debugging/loyalty-discount/repro.test.ts')
    expect(seen).toContain('debugging/loyalty-discount/invariant.test.ts')
    // A bare name would filter by substring and could pull in unrelated suites,
    // which here does not just add noise — it changes the verdict.
    expect(seen).not.toContain('loyalty-discount')
  })

  it('classifies a symptom patch from a real report shape', async () => {
    const verdict = await runDebugTests({
      root: '/repo',
      exercise: 'loyalty-discount',
      runner: reports([{ file: 'invariant.test.ts', failed: ['holds'] }]),
    })
    expect(verdict.kind).toBe('symptom-patch')
  })

  // Both suites ship red, so a non-zero exit is the normal case on this track.
  // Treating the throw as fatal would report every unfinished drill as broken.
  it('prefers the report over a non-zero exit', async () => {
    const verdict = await runDebugTests({
      root: '/repo',
      exercise: 'loyalty-discount',
      runner: async (args, cwd, reportPath) => {
        await reports([{ file: 'repro.test.ts', failed: ['still red'] }])(args, cwd, reportPath)
        throw new Error('vitest exited 1')
      },
    })
    expect(verdict).toEqual({ kind: 'unfixed', failed: ['checkout > still red'] })
  })

  it('errors when no report was written at all', async () => {
    const verdict = await runDebugTests({
      root: '/repo',
      exercise: 'loyalty-discount',
      runner: async () => {
        throw new Error('npx not found')
      },
    })
    expect(verdict).toEqual({ kind: 'errored', message: 'npx not found' })
  })

  it('errors, with a guess at the cause, when the report will not parse', async () => {
    const verdict = await runDebugTests({
      root: '/repo',
      exercise: 'loyalty-discount',
      runner: async (_args, _cwd, reportPath) => {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(reportPath, 'not json')
      },
    })
    expect(verdict.kind).toBe('errored')
    expect(verdict).toMatchObject({ message: expect.stringContaining('syntax or type error') })
  })
})
