/**
 * @param jobs durations, consumed in the order given. May be empty; a
 *   duration may be 0.
 * @param workers how many identical workers run jobs concurrently, one job
 *   each at a time. At least 1.
 * @returns the time the last job finishes, with everything starting at 0.
 *   Each job goes to whichever worker is free soonest.
 */
export function lastFinish(jobs: number[], workers: number): number {
  throw new Error('not implemented')
}
