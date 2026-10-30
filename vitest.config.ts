import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'external',
          include: ['test/external/**/*.test.ts'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
