import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Env validation is process-global; isolated forks stop tests from
    // clobbering each other's process.env.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        // claude.md §14 — raised per milestone as the engine lands.
        lines: 60,
        functions: 60,
      },
    },
  },
});
