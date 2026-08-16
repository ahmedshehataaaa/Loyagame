import { test, expect } from '@playwright/test';

/* Items must stay inside the visible play field — on every screen shape.
 *
 * The geometry is proved exhaustively in tests/unit/field.test.js. What THIS
 * spec exists for is the wiring: `resize()` must actually compute the clamped
 * bounds and `spawnWave()` must actually pass them to the planner. A pure
 * module that is never called is worth nothing, and that is precisely the
 * failure mode ADR 0015 was written about.
 *
 * So these read the tuning the ENGINE hands the planner, in a real round, at a
 * real viewport — not the tuning a test constructs.
 */

const seed = (page) =>
  page.addInitScript(() => {
    localStorage.setItem('mcslice.coached.v1', '1');
    localStorage.setItem('mcslice.identity.v1', JSON.stringify({ cc: '+20', phone: '1001234567' }));
    localStorage.setItem(
      'mcslice.v1',
      JSON.stringify({
        profile: { id: 'p', name: 'Ahmed', isGuest: false },
        progress: {
          rewardPoints: 4200,
          bestScore: 9000,
          lastScore: 0,
          gamesPlayed: 2,
          redeemedRewardIds: [],
          lastRun: null,
        },
        settings: { soundEnabled: false, reducedMotion: false },
      }),
    );
    // Capture what the engine passes the planner, before the engine runs.
    const W = /** @type {any} */ (window);
    W.__waveTuning = null;
    const install = () => {
      if (!W.Mechanics || W.__waveHooked) return;
      W.__waveHooked = true;
      const orig = W.Mechanics.planWave;
      W.Mechanics.planWave = function (args) {
        W.__waveTuning = args.tuning;
        return orig.call(this, args);
      };
    };
    const iv = setInterval(() => {
      install();
      if (W.__waveHooked) clearInterval(iv);
    }, 10);
  });

/** Play until the engine has planned at least one wave, then read its tuning. */
async function engineTuning(page) {
  await page.goto('/index.html?play#/play');
  await expect(page.locator('.game-stake')).not.toHaveText('');
  await page.waitForFunction(() => /** @type {any} */ (window).__waveTuning !== null, null, {
    timeout: 15000,
  });
  return page.evaluate(() => /** @type {any} */ (window).__waveTuning);
}

/**
 * Replay the engine's own tuning through the real planner and walk every
 * trajectory, asserting the sprite never crosses the left, right or top edge
 * of the visible field. Leaving the BOTTOM is by design — items launch from
 * below the field and fall back out of it.
 */
async function measure(page) {
  return page.evaluate(() => {
    const M = window.Mechanics,
      C = window.CONFIG;
    const W = C.WIDTH,
      H = C.HEIGHT,
      g = C.GRAVITY;
    const t = /** @type {any} */ (window).__waveTuning;
    /* Must be the box the ENGINE renders into, not the window. This helper used
       to read window.innerWidth/innerHeight, which was the same assumption that
       caused the bug ADR 0017 fixed: the canvas lives inside the phone-shaped
       shell, so on desktop the two differ by a factor of four. Reading the
       window here made the test compute a visible range the engine never used,
       and every spawn looked like it crossed an edge. */
    const box = window.Platform.viewport();
    const vis = M.visibleVirtualRange({
      viewportW: box.w,
      viewportH: box.h,
      fieldW: W,
      fieldH: H,
    });
    const maxR = Math.max(window.BOMB.radius, ...window.FOODS.map((f) => f.radius));
    const out = { checked: 0, left: 0, right: 0, top: 0, apexMax: t.apexMax };

    for (let i = 0; i < 200; i++) {
      const wave = M.planWave({ difficulty: i / 200, rng: Math.random, tuning: t });
      for (const s of wave.spawns) {
        out.checked++;
        const startX = s.startXFrac * W;
        const L = M.solveLaunch({
          gravity: g,
          fieldHeight: H,
          startX,
          targetX: s.targetXFrac * W,
          apexFrac: s.apexFrac,
        });
        for (let ms = 0; ms <= L.flightSeconds * 1000; ms += 20) {
          const sec = ms / 1000;
          const x = startX + L.vx * sec;
          const y = H + maxR + L.vy * sec + 0.5 * g * sec * sec;
          if ((y - maxR) / H < vis.minYFrac - 1e-6) out.top++;
          if (y / H <= vis.maxYFrac && y / H >= vis.minYFrac) {
            if ((x - maxR) / W < vis.minXFrac - 1e-6) out.left++;
            if ((x + maxR) / W > vis.maxXFrac + 1e-6) out.right++;
          }
        }
      }
    }
    return out;
  });
}

test.describe('items stay inside the visible play field', () => {
  test.beforeEach(async ({ page }) => seed(page));

  test('at the project viewport — the sides are the cropped axis here', async ({ page }) => {
    const t = await engineTuning(page);
    // A portrait phone crops the SIDES, so the planner must be given bounds.
    expect(t.bounds, 'engine passed no spawn bounds to the planner').toBeTruthy();

    const r = await measure(page);
    expect(r.checked).toBeGreaterThan(100);
    expect(r, 'a spawn crossed an edge').toMatchObject({ left: 0, right: 0, top: 0 });
  });

  test('at a desktop window — the phone frame puts the crop back on the SIDES', async ({
    page,
  }) => {
    /* This test used to assert the opposite here, and it was right at the time:
       the engine sized the canvas to the WINDOW, so at 1366x768 the render box
       really was wider than the field, cover scaling overflowed it top and
       bottom, and the configured apex of 0.74 threw items clean through the top
       edge (measured at 1366x577: 76% of spawns escaped, by up to 294px).

       ADR 0017 changed the render box to the phone-shaped shell, which above
       the 700x700 breakpoint is a 390:844 frame — NARROWER than the field. So
       the cropped axis here is the sides, exactly as on a phone, and there is
       no top overflow left for the apex clamp to correct. The clamp is still
       load-bearing and is still covered, in the test below, at a window shape
       that genuinely is wider than the field. */
    await page.setViewportSize({ width: 1366, height: 768 });
    const t = await engineTuning(page);
    expect(t.bounds, 'engine passed no spawn bounds to the planner').toBeTruthy();

    const r = await measure(page);
    expect(r.checked).toBeGreaterThan(100);
    expect(r, 'a spawn crossed an edge').toMatchObject({ left: 0, right: 0, top: 0 });
  });

  test('on a landscape phone — the TOP is the cropped axis, and apex is clamped', async ({
    page,
  }) => {
    /* A rotated phone. `--app-max` goes to 100% under
       `(max-height: 480px) and (orientation: landscape)`, so the render box is
       the full 844x390 — an aspect of 2.16 against the field's 0.5625. Cover
       scaling crops the top and bottom hard, and the configured apex of 0.74
       would throw items clean through the top edge. This is the case the clamp
       exists for, and the one the old 1366x768 desktop assertion used to cover
       before the shell became a phone frame there. */
    await page.setViewportSize({ width: 844, height: 390 });
    const t = await engineTuning(page);

    expect(t.apexMax, 'apex was not clamped to the visible field').toBeLessThan(0.74);

    const r = await measure(page);
    expect(r.checked).toBeGreaterThan(100);
    expect(r, 'a spawn crossed an edge').toMatchObject({ left: 0, right: 0, top: 0 });
  });
});
