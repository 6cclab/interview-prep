import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A couple of voice/http-server.test.ts and voice/spoiler-gate.test.ts
    // cases assert against the real shipped build (rooted at
    // `process.cwd()`, not a fixture directory) — see the comment on
    // voice/test-helpers/build-web.ts for why. This guarantees `voice/dist`
    // exists before any test file runs, once per `vitest run` invocation.
    globalSetup: ['./voice/test-helpers/build-web.ts'],
    include: [
      'problems/**/*.test.ts',
      'debugging/**/*.test.ts',
      'feature/**/*.test.ts',
      'scripts/**/*.test.ts',
      'test-utils/**/*.test.ts',
      'voice/**/*.test.ts',
    ],
    testTimeout: 10_000,
  },
})
