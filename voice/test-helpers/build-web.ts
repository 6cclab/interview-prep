import { resolve } from 'node:path'
import { build } from 'vite'

// Runs a real `vite build`, rooted at the real `voice/web/vite.config.ts`, so
// `voice/dist` reflects the actual shipped client. This is deliberately NOT
// vitest `globalSetup` — a global setup runs once for *every* `vitest run`
// invocation regardless of which test files actually match, which meant
// running a single coding drill (`pnpm vitest run problems/<pattern>/<problem>`
// — this repo's core daily loop) paid for a full Vite build it had nothing to
// do with. Instead, only the test file that genuinely needs the real build
// (voice/spoiler-gate.test.ts) calls this, from its own `beforeAll`, so the
// cost is scoped to runs that include it.
export async function buildWeb(): Promise<void> {
  await build({
    configFile: resolve(process.cwd(), 'voice/web/vite.config.ts'),
    logLevel: 'warn',
  })
}
