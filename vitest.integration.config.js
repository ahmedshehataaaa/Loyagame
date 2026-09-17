import { defineConfig } from 'vitest/config';

/* Integration tests run a real Postgres (and, where needed, the real PostgREST
   binary) per file — see tests/integration/support/stack.js. They are slower
   than the unit suite and need no browser, so they get their own command:
   `npm run test:integration`. */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    environment: 'node',
    // Each file boots its own database; running them one at a time keeps the
    // machine responsive and the failure output readable.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 240000,
    restoreMocks: true,
  },
});
