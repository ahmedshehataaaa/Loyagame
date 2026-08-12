import { defineConfig, devices } from '@playwright/test';

/* The app is static files with no build step, so the dev server is the same
   Python server used by hand (`npm run dev`). Playwright starts it itself so
   `npm run test:e2e` needs no prior setup. */
const PORT = 8766; // deliberately not 8765, so a hand-started dev server can coexist
const PREVIEW_PORT = 8767; // serves the built dist/ for production-build.spec.js

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* The brief's required viewport matrix. Gameplay must be usable on every
     one of these, so every spec runs against all of them.

     The viewport audit is the exception: it drives its OWN viewports (desktop
     1440/1920, tablet, iPhone 14/15) via test.use, so running it inside all six
     mobile projects would repeat the same desktop assertions six times under
     misleading project names. It is excluded here and gets one project below. */
  projects: [
    ...[
      { name: 'iphone-se-320', width: 320, height: 568 },
      { name: 'android-360', width: 360, height: 800 },
      { name: 'iphone-8-375', width: 375, height: 667 },
      { name: 'iphone-14-390', width: 390, height: 844 },
      { name: 'pixel-412', width: 412, height: 915 },
      { name: 'iphone-pro-max-430', width: 430, height: 932 },
    ].map(({ name, width, height }) => ({
      name,
      testIgnore: /viewport-audit\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
      },
    })),
    {
      name: 'audit',
      testMatch: /viewport-audit\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  /* Two servers: the source tree on PORT for most specs, and the built dist/ on
     PREVIEW_PORT for production-build.spec.js. The preview server is allowed to
     fail when dist/ has not been built — those specs skip themselves with a
     clear reason rather than failing confusingly. */
  webServer: [
    {
      command: `python server.py`,
      env: { PORT: String(PORT) },
      url: `http://127.0.0.1:${PORT}/index.html`,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    {
      command: `python -m http.server ${PREVIEW_PORT} --directory dist`,
      url: `http://127.0.0.1:${PREVIEW_PORT}/index.html`,
      reuseExistingServer: true,
      stdout: 'ignore',
      ignoreExitCode: true,
    },
  ],
});
