import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'problems/**/*.test.ts',
      'scripts/**/*.test.ts',
      'test-utils/**/*.test.ts',
    ],
    testTimeout: 10_000,
  },
})
