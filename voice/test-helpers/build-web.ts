import { resolve } from 'node:path'
import { build } from 'vite'

// Vitest `globalSetup`: runs once before the whole run, not per file. A
// couple of `http-server.test.ts`/`spoiler-gate.test.ts` cases deliberately
// exercise the real shipped build (rooted at `process.cwd()`, not a fixture)
// so they prove something about what a real deploy actually serves — that
// requires `voice/dist` to exist before those tests run, hence building it
// here rather than relying on whoever runs the suite to have remembered to.
export default async function setup(): Promise<void> {
  await build({
    configFile: resolve(process.cwd(), 'voice/web/vite.config.ts'),
    logLevel: 'warn',
  })
}
