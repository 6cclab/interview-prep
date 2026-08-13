import { describe, expect, it } from 'vitest'
import { lastFinish } from './solution'

describe('lastFinish — correctness', () => {
  it('walks the worked example', () => {
    // A: [0,3]. B: [0,1] then [1,3]. max(3, 3) = 3.
    expect(lastFinish([3, 1, 2], 2)).toBe(3)
  })

  it('sends each job to the worker free soonest, not round-robin', () => {
    // Round-robin gives A:[0,4],[4,5] -> 5 and B:[0,1],[1,2] -> 2, i.e. 5.
    // Earliest-free gives 4. This is the fixture that separates them.
    expect(lastFinish([4, 1, 1, 1], 2)).toBe(4)
  })

  it('runs sequentially on a single worker', () => {
    expect(lastFinish([5, 5, 5], 1)).toBe(15)
  })

  it('starts every job at zero when workers outnumber jobs', () => {
    expect(lastFinish([5, 5, 5], 10)).toBe(5)
  })

  it('returns the longest job when there is one worker per job', () => {
    expect(lastFinish([2, 9, 4], 3)).toBe(9)
  })

  it('handles no jobs', () => {
    expect(lastFinish([], 4)).toBe(0)
  })

  it('handles zero-duration jobs', () => {
    expect(lastFinish([0, 0], 1)).toBe(0)
  })

  it('handles a zero-duration job among real ones', () => {
    // The 0 must not be treated as "no job" and must not consume time.
    expect(lastFinish([3, 0, 3], 2)).toBe(3)
  })

  it('does not reorder the queue', () => {
    // Sorted ascending this would be [1,1,8] -> A:[0,1],[1,9]? No: sorting
    // gives 8 last, starting at 1, finishing at 9. In queue order the 8 starts
    // at 0 and finishes at 8. A solution that sorts returns 9 here.
    expect(lastFinish([8, 1, 1], 2)).toBe(8)
  })

  it('handles a single job', () => {
    expect(lastFinish([7], 3)).toBe(7)
  })

  it('handles large durations without overflow or tick-by-tick looping', () => {
    // 1e9 each. Anything advancing a clock one unit at a time does not return.
    expect(lastFinish([1_000_000_000, 1_000_000_000], 1)).toBe(2_000_000_000)
  })
})

describe('lastFinish — scale', () => {
  /**
   * The correct-but-linear-scan solution is the target: for each job, look at
   * all w workers to find the earliest-free one. That is O(n*w), and at
   * 400,000 jobs against 100,000 workers it is 4e10 operations. Measured:
   * 24ms for the ordered-structure solution, 30s for the scan.
   *
   * The worker count is deliberately large. With only a handful of workers the
   * scan is cheap and the two approaches are indistinguishable — it is w
   * growing that separates O(n*w) from O(n log w).
   *
   * The expected value is derived analytically rather than by running a second
   * implementation: every job has duration exactly 1 and there are 400,000 jobs
   * across 100,000 workers, so the queue passes over the pool exactly 4 times
   * and every worker ends busy until time 4.
   */
  it('finishes well within budget on many jobs across many workers', () => {
    const WORKERS = 100_000
    const JOBS = 400_000
    const jobs = new Array<number>(JOBS).fill(1)

    const t0 = performance.now()
    const result = lastFinish(jobs, WORKERS)
    const elapsed = performance.now() - t0

    expect(result).toBe(JOBS / WORKERS)
    // Vitest's testTimeout does not reliably preempt a synchronous, CPU-bound
    // loop, so elapsed time is measured explicitly rather than relied on.
    expect(elapsed).toBeLessThan(5000)
  })

  it('finishes well within budget when durations vary', () => {
    // Uniform durations let a solution get the right answer by accident — the
    // pool stays perfectly balanced, so "pick any worker" also works. Varying
    // them means the choice of worker actually matters at scale.
    //
    // Sized so the scan fails here too. At 20,000 workers it ran in 3.0s and
    // passed, which made this test useless as a cost gate.
    const WORKERS = 80_000
    const JOBS = 400_000
    const jobs = Array.from({ length: JOBS }, (_, i) => (i % 7) + 1)

    const t0 = performance.now()
    const result = lastFinish(jobs, WORKERS)
    const elapsed = performance.now() - t0

    // Total work is fixed and the pool is saturated, so the finish time cannot
    // be below the perfectly-balanced average, nor above that plus the longest
    // single job.
    const total = jobs.reduce((a, b) => a + b, 0)
    const lowerBound = Math.floor(total / WORKERS)
    expect(result).toBeGreaterThanOrEqual(lowerBound)
    expect(result).toBeLessThanOrEqual(lowerBound + 7)
    expect(elapsed).toBeLessThan(5000)
  })
})
