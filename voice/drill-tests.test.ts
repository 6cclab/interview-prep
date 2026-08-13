import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runDrillTests } from './drill-tests'

describe('runDrillTests', () => {
  const problem = { slug: 'container-with-most-water', pattern: 'two-pointers' }

  /** A report in vitest's real shape — see failedTestsFromJson's fixture. */
  function jsonFor(failed: { suite: string; title: string }[]): string {
    return JSON.stringify({
      testResults: [
        {
          assertionResults: failed.map(({ suite, title }) => ({
            status: 'failed',
            title,
            ancestorTitles: [suite],
          })),
        },
      ],
    })
  }

  /** A stand-in vitest: writes the report it would have written, and nothing else. */
  function reports(failed: { suite: string; title: string }[]) {
    return async (_args: string[], _cwd: string, reportPath: string) => {
      writeFileSync(reportPath, jsonFor(failed))
    }
  }

  it('runs the resolved test file, not a substring filter on the slug', async () => {
    let seen: string[] = []
    await runDrillTests({
      root: '/repo',
      problem,
      runner: async (args, _cwd, reportPath) => {
        seen = args
        writeFileSync(reportPath, jsonFor([]))
      },
    })
    // A bare slug would let `vitest run` match unrelated suites elsewhere in the
    // repo and fold them into this drill's verdict.
    expect(seen).toContain('problems/two-pointers/container-with-most-water/solution.test.ts')
    expect(seen).toContain('--reporter=json')
  })

  it('classifies a failing run', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: reports([{ suite: 'maxArea — scale', title: 'big input' }]),
    })
    expect(verdict.kind).toBe('cost-red')
  })

  // A failing suite exits non-zero, so execFile rejects — but vitest has still
  // written its report. Treating that as "could not run" would turn every red
  // drill into an error and lose the distinction entirely.
  it('reads the report off a non-zero exit rather than calling it an error', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      // A failing suite: vitest writes its report and *then* exits non-zero.
      runner: async (_args, _cwd, reportPath) => {
        writeFileSync(reportPath, jsonFor([{ suite: 'maxArea — correctness', title: 'canonical' }]))
        throw new Error('Command failed')
      },
    })
    expect(verdict).toEqual({
      kind: 'correctness-red',
      failed: ['maxArea — correctness > canonical'],
    })
  })

  it('reports a genuine failure to run as errored, not as a red drill', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async () => {
        throw new Error('spawn npx ENOENT')
      },
    })
    expect(verdict.kind).toBe('errored')
  })

  it('treats unparseable output as a solution that would not compile', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async (_args, _cwd, reportPath) => {
        writeFileSync(reportPath, 'Transform failed with 1 error')
      },
    })
    expect(verdict.kind).toBe('errored')
    if (verdict.kind === 'errored') expect(verdict.message).toMatch(/syntax or type error/i)
  })

  // The reason the report goes to a file at all: stdout is shared with whatever
  // the solution logs, and a mid-drill `console.log({ n: 3 })` is entirely
  // normal. Scanning stdout for the payload broke on exactly this.
  it('is unaffected by console output the solution printed', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async (args, _cwd, reportPath) => {
        expect(args.some((a) => a.startsWith('--outputFile='))).toBe(true)
        writeFileSync(reportPath, jsonFor([]))
      },
    })
    expect(verdict.kind).toBe('green')
  })

  // The pattern is the answer, and vitest prints the path of every suite it
  // runs. Anything derived from test output is scrubbed on the way out.
  it('never lets the pattern out through a failing test name', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: reports([
        { suite: 'problems/two-pointers/container-with-most-water/solution.test.ts > maxArea — scale', title: 'x' },
      ]),
    })
    expect(JSON.stringify(verdict)).not.toContain('two-pointers')
  })

  it('never lets the pattern out through a run error either', async () => {
    const verdict = await runDrillTests({
      root: '/repo',
      problem,
      runner: async () => {
        throw new Error('ENOENT: problems/two-pointers/container-with-most-water/solution.ts')
      },
    })
    expect(JSON.stringify(verdict)).not.toContain('two-pointers')
  })
})
