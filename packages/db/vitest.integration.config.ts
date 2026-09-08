import { defineConfig } from 'vitest/config';

/**
 * Integration tests need a real PostgreSQL (DATABASE_URL_TEST). They are skipped
 * when it is absent so `pnpm test` stays green on machines without a database;
 * CI sets DATABASE_URL_TEST and runs them.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
