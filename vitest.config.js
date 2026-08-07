import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests cover pure logic extracted from the engine (spawn planning,
    // collision maths, round rules). Browser-dependent behaviour is covered by
    // Playwright instead — see tests/e2e/.
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
  },
});
