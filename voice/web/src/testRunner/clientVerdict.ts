import type { DrillVerdict } from '../../../drill-verdict'
import { runInWorker, type RunnerWorker } from './runner'

/** What `GET /api/coding/<slug>/exercise` returns. */
interface ExerciseResponse {
  stub: string
  test: string
  utils: Record<string, string>
}

/**
 * The default Worker, built the way Vite wants so the worker entry is bundled
 * as its own chunk rather than inlined into the page.
 */
function spawnWorker(): RunnerWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as RunnerWorker
}

/**
 * Run a drill's suite in this browser and return the same verdict the server
 * would have produced.
 *
 * `fetchFn` and `spawn` are parameters so this is testable without a browser:
 * everything that decides an outcome lives here, and what is left in the Worker
 * shell is message plumbing.
 *
 * A failure to *fetch* is reported as `errored`, never as a pass. A drill that
 * quietly went green because the network dropped is worse than one that says it
 * could not run — the candidate would take a false green as a solve.
 */
export async function computeVerdictInBrowser(
  slug: string,
  /** The editor buffer. The stub is only ever the seed for an empty one. */
  solution: string,
  fetchFn: typeof fetch = fetch,
  spawn: () => RunnerWorker = spawnWorker,
): Promise<DrillVerdict> {
  let exercise: ExerciseResponse
  try {
    const res = await fetchFn(`/api/coding/${slug}/exercise`)
    if (!res.ok) return { kind: 'errored', message: 'could not load the exercise' }
    exercise = (await res.json()) as ExerciseResponse
  } catch {
    return { kind: 'errored', message: 'could not reach the drill server' }
  }

  return runInWorker({ test: exercise.test, utils: exercise.utils, solution }, spawn)
}
