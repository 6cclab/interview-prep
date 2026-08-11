import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No globalSetup here on purpose: only voice/spoiler-gate.test.ts's real-
    // build case needs `voice/dist` to exist, and it builds it itself in its
    // own `beforeAll` (see voice/test-helpers/build-web.ts). A globalSetup
    // runs for every `vitest run` invocation regardless of which test files
    // match — including a single coding drill under `problems/**`, this
    // repo's core daily loop, which has nothing to do with the web client.
    include: [
      'problems/**/*.test.ts',
      'debugging/**/*.test.ts',
      'feature/**/*.test.ts',
      'scripts/**/*.test.ts',
      'test-utils/**/*.test.ts',
      'voice/**/*.test.ts',
      'voice/**/*.test.tsx',
    ],
    testTimeout: 10_000,
  },
})
