import { test, expect } from '@playwright/test';

/* These specs deliberately avoid asserting on wall-clock round progress.
   Headless Chromium throttles requestAnimationFrame hard (measured: ~1.3fps in
   this harness), so a test that waits 30 real seconds for a round to end is
   flaky for reasons that have nothing to do with the game. Round-length,
   win/loss and difficulty-curve rules are covered deterministically in
   tests/unit/ instead; these specs cover what only a browser can prove —
   layout, coordinate mapping, and that exactly one HUD exists. */

/**
 * Fresh guest session, landed on the play screen.
 *
 * A first-time player cannot go straight from PLAY NOW to the round: /play is
 * guarded on having a profile, so PLAY NOW lands on sign-in and the player has
 * to pick "Continue as guest" first. That extra wall is itself a finding in the
 * audit (the brief asks for minimal verification and a fast start), but until
 * the flow changes the test has to walk the flow that actually exists.
 */
async function startRound(page) {
  await page.goto('/index.html#/');
  await page.getByRole('button', { name: /play now/i }).click();

  // Either the guard bounced us to sign-in, or a profile already existed.
  if (/#\/sign-in$/.test(new URL(page.url()).hash ? page.url() : '')) {
    await page.getByRole('button', { name: /continue as guest/i }).click();
  } else {
    await expect(page).toHaveURL(/#\/(play|sign-in)$/);
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
  }

  await expect(page).toHaveURL(/#\/play$/);
  await page.locator('#game').waitFor({ state: 'attached' });
}

test.describe('portrait layout', () => {
  test('welcome screen never scrolls horizontally', async ({ page }) => {
    await page.goto('/index.html#/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('play screen never scrolls horizontally', async ({ page }) => {
    await startRound(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the stage is upright — no 90 degree rotation', async ({ page }) => {
    // The regression this locks in: the engine used to fake portrait support by
    // rotating #stage 90deg in CSS, which left the canvas and its HUD lying on
    // their side underneath the un-rotated DOM HUD.
    await startRound(page);
    const transform = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('stage'));
      return s.transform;
    });
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
  });

  test('the play field fills the viewport', async ({ page }) => {
    await startRound(page);
    const fit = await page.evaluate(() => {
      const r = document.getElementById('game').getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    // Cover, not letterbox: within a pixel of the viewport on both axes.
    expect(Math.abs(fit.w - fit.vw)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.h - fit.vh)).toBeLessThanOrEqual(1);
  });

  test('portrait viewports are taller than wide (the field is authored portrait)', async ({
    page,
  }) => {
    await startRound(page);
    const cfg = await page.evaluate(() => ({ w: window.CONFIG.WIDTH, h: window.CONFIG.HEIGHT }));
    expect(cfg.h).toBeGreaterThan(cfg.w);
  });
});

test.describe('HUD', () => {
  test('exactly one of each HUD readout is rendered', async ({ page }) => {
    // The regression this locks in: the canvas drew score/time/lives AND the
    // DOM overlay drew them too, so both appeared at once and disagreed.
    await startRound(page);
    await expect(page.locator('.hud__score')).toHaveCount(1);
    await expect(page.locator('.hud__time')).toHaveCount(1);
    await expect(page.locator('.hud__lives')).toHaveCount(1);
  });

  test('HUD seeds from config, not stale literals', async ({ page }) => {
    await startRound(page);
    const cfg = await page.evaluate(() => ({
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
    }));
    // Was hardcoded to '60' and three hearts — the pre-30s/2-life values.
    await expect(page.locator('.hud__goal')).toHaveText(new RegExp(`${cfg.round}`));
    const hearts = await page.locator('.hud__lives').innerText();
    expect(hearts.replace(/[^❤]/g, '').length).toBe(cfg.lives);
  });

  test('the goal is survival, not a score target', async ({ page }) => {
    await startRound(page);
    await expect(page.locator('.hud__goal')).toHaveText(/survive/i);
    await expect(page.locator('.hud__goal')).not.toHaveText(/target/i);
  });

  test('lives never show more than the configured start', async ({ page }) => {
    await startRound(page);
    const lives = Number(await page.locator('#game').getAttribute('data-lives'));
    const start = await page.evaluate(() => window.CONFIG.START_LIVES);
    expect(lives).toBeLessThanOrEqual(start);
    expect(lives).toBe(start);
  });
});

test.describe('slice input', () => {
  test('a swipe across an airborne item scores', async ({ page }) => {
    // Proves the client->game coordinate mapping is correct in portrait. When
    // the stage was rotated, this mapping needed a swap/flip term; getting it
    // wrong silently made the whole field unhittable.
    await startRound(page);

    const scored = await page.evaluate(async () => {
      const canvas = document.getElementById('game');
      const rect = canvas.getBoundingClientRect();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fire = (type, x, y, target) =>
        target.dispatchEvent(
          new MouseEvent(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

      // Let a wave get airborne under a throttled rAF loop.
      await sleep(6000);

      for (const frac of [0.32, 0.4, 0.48, 0.56, 0.64]) {
        const y = rect.top + rect.height * frac;
        fire('mousedown', rect.left + 6, y, canvas);
        for (let i = 1; i <= 24; i++) {
          fire('mousemove', rect.left + 6 + (rect.width - 12) * (i / 24), y, window);
          await sleep(10);
        }
        fire('mouseup', rect.left + rect.width - 6, y, window);
        await sleep(500);
        if (Number(canvas.dataset.score) > 0) break;
      }
      return Number(canvas.dataset.score);
    });

    expect(scored).toBeGreaterThan(0);
  });
});

test.describe('lifecycle', () => {
  test('leaving the play route tears the round down', async ({ page }) => {
    await startRound(page);
    await page.evaluate(() => {
      location.hash = '#/';
    });
    await expect(page).toHaveURL(/#\/$/);
    // The shared canvas must be hidden again once the route is gone.
    await expect(page.locator('#stage')).not.toHaveClass(/is-playing/);
  });

  test('hiding the tab pauses rather than draining the clock', async ({ page }) => {
    await startRound(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByText(/paused/i)).toBeVisible();
  });
});
