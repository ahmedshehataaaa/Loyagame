import { defineConfig, devices } from '@playwright/test';

/* The app is static files with no build step, so the dev server is the same
   Python server used by hand (`npm run dev`). Playwright starts it itself so
   `npm run test:e2e` needs no prior setup. */
const PORT = 8766; // deliberately not 8765, so a hand-started dev server can coexist

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
     one of these, so every spec runs against all of them. */
  projects: [
    {
      name: 'iphone-se-320',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 320, height: 568 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'android-360',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 800 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'iphone-8-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'iphone-14-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'pixel-412',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 412, height: 915 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'iphone-pro-max-430',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 430, height: 932 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],

  webServer: {
    command: `python server.py`,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
