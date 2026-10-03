import { test, expect } from '@playwright/test';

/* These specs deliberately avoid asserting on wall-clock round progress.
   Headless Chromium throttles requestAnimationFrame hard (measured: ~1.3fps in
   this harness), so a test that waits 30 real seconds for a round to end is
   flaky for reasons that have nothing to do with the game. Round-length,
   win/loss and difficulty-curve rules are covered deterministically in
   tests/unit/ instead; these specs cover what only a browser can prove —
   layout, coordinate mapping, and that exactly one HUD exists. */

/**
 * A first-time player, landed on the play screen through the real flow.
 *
 * The redesign replaced "Continue as guest" with phone-only sign-in, and this
 * helper kept waiting for the guest button. Every gameplay spec below timed
 * out in setup and never ran, which is how gameplay regressions shipped
 * unnoticed. Walk the flow that exists: PLAY NOW, enter a number, Play.
 */
async function startRound(page) {
  // The how-to-play card gates the first round on a fresh device and pauses
  // behind itself; these specs test layout and input, so skip it.
  await page.addInitScript(() => localStorage.setItem('mcslice.coached.v1', '1'));
  // No backend in this harness: grant the round so play starts cleanly.
  await page.route('**/api/start-run', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        granted: true,
        token: '11111111-1111-4111-8111-111111111111',
      }),
    }),
  );
  await page.goto('/index.html#/');
  await page.getByRole('button', { name: /play now/i }).click();
  if (/#\/sign-in$/.test(page.url())) {
    await page.locator('.signin__phone-input').fill('(415) 555-0123');
    await page.getByRole('button', { name: /^play$/i }).click();
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
  /** Wait until something is actually airborne — the precondition for a slice. */
  async function waitForItems(page) {
    await page
      .waitForFunction(
        () => {
          const cv = /** @type {any} */ (document.getElementById('game'));
          if (!cv?.width) return false;
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 24 && ++n > 30) return true;
          return false;
        },
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
  }

  const score = async (page) => Number(await page.locator('#game').getAttribute('data-score'));

  test('the play overlay does not swallow pointer input', async ({ page }) => {
    /* THE REGRESSION THIS EXISTS FOR, and it was a real one: `.game-screen` is a
       full-height flex container laid over the canvas to position the HUD. With
       default pointer-events it won the hit test across the ENTIRE play field,
       so mousedown/touchstart never reached the canvas and NOTHING could be
       sliced by a real player.

       It survived because the older test dispatched MouseEvents directly onto
       the canvas element, which bypasses hit-testing entirely — proving the
       engine's maths, not that input could reach it. So this asserts on
       elementFromPoint: what a real finger would actually hit. */
    await startRound(page);
    const hits = await page.evaluate(() => {
      const at = (x, y) => document.elementFromPoint(x, y)?.id ?? '';
      const w = window.innerWidth;
      const h = window.innerHeight;
      return [
        at(w / 2, h * 0.3),
        at(w / 2, h * 0.5),
        at(w / 2, h * 0.7),
        at(w * 0.15, h * 0.5),
        at(w * 0.85, h * 0.5),
      ];
    });
    for (const id of hits) expect(id).toBe('game');
  });

  test('the HUD controls still receive taps', async ({ page }) => {
    // Making the overlay pointer-transparent must not take the buttons with it.
    await startRound(page);
    await page.getByRole('button', { name: /pause/i }).click();
    await expect(page.getByText(/paused/i)).toBeVisible();
  });

  test('a real mouse swipe scores', async ({ page }) => {
    /* Driven through Playwright's real input pipeline — hit-tested, exactly as a
       player's would be — rather than by dispatching events at the canvas. */
    await startRound(page);
    await waitForItems(page);

    const size = page.viewportSize();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && (await score(page)) === 0) {
      for (const frac of [0.32, 0.42, 0.52, 0.62, 0.72]) {
        const y = size.height * frac;
        await page.mouse.move(8, y);
        await page.mouse.down();
        for (let i = 1; i <= 25; i++) {
          await page.mouse.move(8 + ((size.width - 16) * i) / 25, y);
        }
        await page.mouse.up();
        if ((await score(page)) > 0) break;
        await page.waitForTimeout(80);
      }
    }
    expect(await score(page)).toBeGreaterThan(0);
    expect(Number(await page.locator('#game').getAttribute('data-slices'))).toBeGreaterThan(0);
  });

  test('a real touch-pointer swipe scores', async ({ page }) => {
    // The primary input for this game is a finger, so it gets its own case.
    await startRound(page);
    await waitForItems(page);

    const size = page.viewportSize();
    const canvas = page.locator('#game');
    const send = (type, x, y) =>
      canvas.dispatchEvent(type, {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      });

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && (await score(page)) === 0) {
      for (const frac of [0.32, 0.42, 0.52, 0.62, 0.72]) {
        const y = size.height * frac;
        await send('pointerdown', 8, y);
        for (let i = 1; i <= 25; i++) {
          await send('pointermove', 8 + ((size.width - 16) * i) / 25, y);
        }
        await send('pointerup', size.width - 8, y);
        if ((await score(page)) > 0) break;
        await page.waitForTimeout(80);
      }
    }
    expect(await score(page)).toBeGreaterThan(0);
  });

  test('the engine uses Pointer Events, not parallel mouse and touch paths', async ({ page }) => {
    /* Both pairs bound at once meant every swipe on a touch device ran through
       two code paths (browsers emit compatibility mouse events), and neither
       could follow a finger off the canvas. */
    await startRound(page);
    const hasPointer = await page.evaluate(() => typeof window.PointerEvent === 'function');
    expect(hasPointer).toBe(true);
  });
});

test.describe('browser zoom below 100%', () => {
  /* At 75% zoom devicePixelRatio is 0.75. clearFrame() used to clear
     canvas.width x canvas.height UNDER the dpr transform, which covered only
     75% of each side, so the right and bottom strips were never wiped and
     every sprite crossing them smeared into a trail of copies. */
  test.use({ deviceScaleFactor: 0.75 });

  test('every frame clears the whole canvas, edges included', async ({ page }) => {
    await startRound(page);
    await page.locator('.game-stage.is-playing').waitFor({ state: 'visible' });
    const opaqueCorner = await page.evaluate(async () => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
      const g = c.getContext('2d');
      // Paint everything, then let the engine draw two frames over it.
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#00ff00';
      g.fillRect(0, 0, c.width, c.height);
      g.restore();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The bottom-right corner is outside the old cleared area.
      const d = g.getImageData(c.width - 6, c.height - 6, 4, 4).data;
      let green = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i + 1] === 255 && d[i] === 0 && d[i + 3] === 255) green++;
      return green;
    });
    expect(opaqueCorner, 'paint left behind in the bottom-right corner').toBe(0);
  });
});

test.describe('desktop frame', () => {
  /* On desktop the shell is a centred phone frame. The Spin to Win overlay
     is position: fixed, and components.css's base `inset: 0` used to win the
     cascade over base.css's desktop centring, so the wheel opened half off
     the LEFT edge of the window instead of over the game. */
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('the round-end wheel opens exactly over the game frame', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mcslice.coached.v1', '1');
      localStorage.setItem(
        'mcslice.identity.v1',
        JSON.stringify({ cc: '+1', phone: '4155550123' }),
      );
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'p_desk', name: 'Player 0123', isGuest: false },
          progress: {
            rewardPoints: 0,
            bestScore: 0,
            lastScore: 0,
            gamesPlayed: 1,
            redeemedRewardIds: [],
            lastRun: null,
          },
          settings: { soundEnabled: false, reducedMotion: true },
        }),
      );
    });
    const token = '11111111-1111-4111-8111-111111111111';
    await page.route('**/api/start-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, granted: true, token }),
      }),
    );
    await page.route('**/api/submit-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          won: true,
          prize: { key: 'side1', label: 'Free Fries' },
          code: 'AB12CD',
        }),
      }),
    );
    await page.goto('/index.html?play#/play');
    await page.locator('.game-stage.is-playing').waitFor({ state: 'visible' });
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(24800, 30000, {
        survived: true,
        outcome: 'survived',
        livesRemaining: 1,
      });
      window.UI.showChooser(24800, r);
    });
    const overlay = page.locator('.spin-overlay');
    await overlay.waitFor({ state: 'visible' });
    const frame = await page.locator('#app').boundingBox();
    const box = await overlay.boundingBox();
    expect(Math.abs(box.x - frame.x), 'wheel left edge vs frame').toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - frame.width), 'wheel width vs frame').toBeLessThanOrEqual(1);
  });
});
