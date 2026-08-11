import { test, expect } from '@playwright/test';

/* The Spin to Win flow, end to end.
 *
 * The property that matters most: the wheel is a REVEAL. The server mints the
 * coupon and picks the prize; the spin only shows which. These specs assert the
 * ordering (server call strictly before the animation) and that the wheel lands
 * on whatever the server said — including when the server picks the rarest
 * prize, which a client-side random would essentially never choose. */

const TOKEN = '11111111-2222-3333-4444-555555555555';

const seedPlayer = (page) =>
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
  });

const json =
  (payload, status = 200) =>
  (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

/** Grant the round; answer submit-run with whatever the test needs. */
async function backend(page, submit, opts = {}) {
  await page.route('**/api/start-run', json({ ok: true, granted: true, token: TOKEN }));
  if (submit === 'abort') {
    await page.route('**/api/submit-run', (r) => r.abort('failed'));
  } else if (submit) {
    await page.route('**/api/submit-run', json(submit, opts.status ?? 200));
  }
}

/** Play, then finish the round as a survivor so the wheel appears. */
async function surviveRound(page, score = 42000) {
  await page.goto('/index.html#/play');
  await expect(page.locator('.game-stake')).not.toHaveText('');
  await page.evaluate(async (s) => {
    const r = await window.LoyaltyData.submitRun(s, 30000, {
      survived: true,
      outcome: 'survived',
      itemsSliced: 40,
      bestCombo: 5,
    });
    window.UI.showChooser(s, r);
  }, score);
}

test.describe('the wheel appears on a win and never on a loss', () => {
  test.beforeEach(async ({ page }) => seedPlayer(page));

  test('a survived round opens Spin to Win', async ({ page }) => {
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'fries', label: 'Free Fries' },
      code: 'MC-ABCD-2345',
      orderPoints: 200,
      pointsThreshold: 4000,
    });
    await surviveRound(page);

    await expect(page.locator('.spin-overlay')).toBeVisible();
    await expect(page.locator('.spin__title')).toHaveText(/spin to win/i);
    await expect(page.getByRole('button', { name: /spin now/i })).toBeVisible();
    // Still on the play route — the wheel is an overlay, not a screen.
    await expect(page).toHaveURL(/#\/play$/);
  });

  test('a lost round skips the wheel entirely and shows the loss screen', async ({ page }) => {
    await backend(page, { ok: true, won: false });
    await page.goto('/index.html#/play');
    await expect(page.locator('.game-stake')).not.toHaveText('');
    await page.evaluate(() => window.UI.showTryAgain(1200, 0, null, false));

    await expect(page).toHaveURL(/#\/result$/);
    await expect(page.locator('.spin-overlay')).toHaveCount(0);
    await expect(page.locator('.result--lost')).toBeVisible();
  });
});

test.describe('the server decides; the spin only reveals', () => {
  test.beforeEach(async ({ page }) => seedPlayer(page));

  test('the coupon endpoint is called BEFORE the wheel animates', async ({ page }) => {
    const order = [];
    await page.route('**/api/start-run', json({ ok: true, granted: true, token: TOKEN }));
    await page.route('**/api/submit-run', (route) => {
      order.push('submit-run');
      return json({
        ok: true,
        won: true,
        prize: { key: 'fries', label: 'Free Fries' },
        code: 'MC-ABCD-2345',
      })(route);
    });

    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();
    order.push('spin');

    // If the animation ever preceded the mint, the client would be choosing a
    // real-money outcome and asking the server to honour it.
    expect(order.indexOf('submit-run')).toBeLessThan(order.indexOf('spin'));
  });

  test('lands on the segment the server chose — even the rarest prize', async ({ page }) => {
    /* `off25` carries a 0.2% weight. A client-side random would essentially
       never select it, so seeing it revealed proves the wheel is following the
       server rather than rolling its own. */
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'off25', label: '25% off your order' },
      code: 'MC-RARE-9999',
      wheel: [
        { key: 'off5', label: '5% off your order' },
        { key: 'fries', label: 'Free Fries' },
        { key: 'off25', label: '25% off your order' },
      ],
    });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();

    await expect(page.locator('.spin__prize')).toHaveText(/25% off your order/i, {
      timeout: 15000,
    });
  });

  test('shows the coupon code the server minted, verbatim', async ({ page }) => {
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'bigmac', label: 'Free Big Mac®' },
      code: 'MC-WXYZ-7788',
    });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();

    await expect(page.locator('.spin__code-value')).toHaveText('MC-WXYZ-7788', { timeout: 15000 });
  });

  test('copy-to-clipboard puts the real code on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'fries', label: 'Free Fries' },
      code: 'MC-COPY-1234',
    });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();
    await expect(page.locator('.spin__code-value')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /copy code/i }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (clip !== null) expect(clip).toBe('MC-COPY-1234');
    // Whether or not the clipboard is readable in this context, the button must
    // acknowledge the action rather than sit inert.
    await expect(page.getByRole('button', { name: /copied|selected/i })).toBeVisible();
  });
});

test.describe('no prize means no spin', () => {
  test.beforeEach(async ({ page }) => seedPlayer(page));

  test('an ineligible survivor is told why, and the wheel never turns', async ({ page }) => {
    // A wheel that spins and lands on nothing reads as a loss the player
    // caused, when in fact they simply had too few order points.
    await backend(page, {
      ok: true,
      won: false,
      survived: true,
      orderPoints: 1200,
      pointsThreshold: 4000,
    });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();

    await expect(page.locator('.spin__status')).toContainText(/order points/i, { timeout: 10000 });
    await expect(page.locator('.spin__prize')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /spin now/i })).toHaveCount(0);
  });

  test('a flagged run is not paid out through the wheel', async ({ page }) => {
    await backend(page, {
      ok: true,
      won: true,
      suspicious: true,
      prize: { key: 'bigmac', label: 'Free Big Mac®' },
      code: 'MC-SHOULD-NOT-SHOW',
    });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();
    await page.waitForTimeout(800);

    await expect(page.locator('.spin__prize')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('MC-SHOULD-NOT-SHOW');
  });
});

test.describe('a signed-out player is told what to do, not that the app is broken', () => {
  /* The original complaint: every win showed "Rewards are not available in this
     build" with a TRY AGAIN button. Two different things had collapsed into one
     status — a player with no identity, and a build with the reward API off —
     so a guest was blamed on the app's behalf and offered a button that could
     not possibly help. */
  test('no identity means "sign in to win", with a button that goes there', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mcslice.coached.v1', '1');
      localStorage.removeItem('mcslice.identity.v1');
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'g', name: 'Guest Slicer', isGuest: true },
          progress: {
            rewardPoints: 0,
            bestScore: 0,
            lastScore: 0,
            gamesPlayed: 0,
            redeemedRewardIds: [],
            lastRun: null,
          },
          settings: { soundEnabled: false, reducedMotion: false },
        }),
      );
    });

    await page.goto('/index.html#/play');
    await expect(page.locator('.game-stake')).not.toHaveText('');
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(42000, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(42000, r);
    });

    await page.locator('.spin-overlay [data-act="spin"]').click();

    await expect(page.locator('.spin__status')).toContainText(/sign in/i);
    await expect(page.locator('body')).not.toContainText(/not available in this build/i);
    await expect(page.locator('.spin__prize')).toHaveCount(0);
    // Retrying an unattributable round is a dead button; the real fix is here.
    await expect(page.locator('.spin-overlay [data-act="retry"]')).toHaveCount(0);
    await page.locator('.spin-overlay [data-act="signin"]').click();
    await expect(page).toHaveURL(/#\/sign-in$/);
  });
});

test.describe('coupon endpoint failure is handled gracefully', () => {
  test.beforeEach(async ({ page }) => seedPlayer(page));

  test('a network failure offers a retry and issues no prize', async ({ page }) => {
    await backend(page, 'abort');
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();

    await expect(page.locator('.spin__status')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.spin__prize')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  test('a 500 shows an error state, not a prize', async ({ page }) => {
    await backend(page, { ok: false, error: 'server_error' }, { status: 500 });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();

    await expect(page.locator('.spin__prize')).toHaveCount(0);
    await expect(page.locator('.spin__status')).toContainText(/no prize has been issued/i, {
      timeout: 10000,
    });
  });

  test('closing the wheel always reaches the result screen', async ({ page }) => {
    // However the reveal ends, the player must never be stranded on the wheel.
    await backend(page, { ok: false, error: 'server_error' }, { status: 500 });
    await surviveRound(page);
    await page.getByRole('button', { name: /spin now/i }).click();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page).toHaveURL(/#\/result$/);
  });
});

test.describe('accessibility and motion', () => {
  test('reduced motion skips the spin but still reveals the prize', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await seedPlayer(page);
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'fries', label: 'Free Fries' },
      code: 'MC-RM-0001',
    });
    await page.goto('/index.html#/play');
    await expect(page.locator('.game-stake')).not.toHaveText('');
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(42000, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(42000, r);
    });
    await page.getByRole('button', { name: /spin now/i }).click();

    // No waiting on a 4-second animation that was never going to play.
    await expect(page.locator('.spin__prize')).toHaveText(/free fries/i, { timeout: 3000 });
    await ctx.close();
  });

  test('the outcome is announced in a live region, not only on the wheel', async ({ page }) => {
    // The wheel is aria-hidden decoration; without this a screen-reader user
    // would get nothing at all from the reveal.
    await seedPlayer(page);
    await backend(page, {
      ok: true,
      won: true,
      prize: { key: 'fries', label: 'Free Fries' },
      code: 'MC-A11Y-0001',
    });
    await surviveRound(page);
    await expect(page.locator('.spin__status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.wheel')).toHaveAttribute('aria-hidden', 'true');
  });
});
