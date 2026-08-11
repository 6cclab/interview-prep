import { afterAll, beforeAll } from 'vitest'

/**
 * `chooseBackend` refuses to guess when nothing is set — there is no default,
 * on purpose (see `voice/backend.ts`). Integration suites here spin up the
 * real HTTP server and end real sessions, which reads the backend through the
 * same path a live drill does, so they need to choose one just like a real
 * invocation (`pnpm mock:web:claude`) would.
 *
 * This does not stand in for `voice/backend.test.ts`, which is the one place
 * that tests `chooseBackend` itself, including the unset case. It exists so
 * every *other* suite that merely needs a server to run doesn't have to
 * restate the same env dance to get one.
 */
export function useCliBackend(): void {
  let original: string | undefined

  beforeAll(() => {
    original = process.env.VOICE_BACKEND
    process.env.VOICE_BACKEND = 'cli'
  })

  afterAll(() => {
    if (original === undefined) delete process.env.VOICE_BACKEND
    else process.env.VOICE_BACKEND = original
  })
}
