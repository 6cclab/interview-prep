import { executeSuite, type Exercise } from './execute'
import type { WorkerReply } from './runner'

/**
 * The Worker entry point.
 *
 * Deliberately the thinnest possible shell. Everything with a decision in it
 * lives in `execute.ts` (what to run) and `runner.ts` (when to give up), both
 * of which are exercised under Node — `execute.ts` against all 42 real suites.
 * This file is the one piece no Node test can reach, so it is kept to the
 * message plumbing and nothing else.
 *
 * There is no timeout here on purpose. Code that spins cannot time itself out:
 * no timer in this thread will fire while a `while (true)` holds it. The only
 * stop is `terminate()` from the main thread, which is `runner.ts`'s job.
 */
const ctx = self as unknown as {
  onmessage: ((event: { data: Exercise }) => void) | null
  postMessage(reply: WorkerReply): void
}

ctx.onmessage = async (event): Promise<void> => {
  try {
    ctx.postMessage({ ok: true, failed: await executeSuite(event.data) })
  } catch (error) {
    // The candidate's own syntax or runtime error, which is theirs to see —
    // unlike a matcher's message, which would quote the fixture it compared
    // against. `executeSuite` has already dropped those.
    ctx.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}
