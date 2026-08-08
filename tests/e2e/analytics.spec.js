import { test, expect } from '@playwright/test';

/* Verifies the events the REAL app emits, and that nothing sensitive rides
   along. The unit tests prove the redactor; these prove the call sites actually
   use it, on real journeys — which is the part a redactor cannot guarantee on
   its own.

   No analytics vendor is wired (ADR 0014), so events buffer in memory. The
   tests install a sink through the same public seam a vendor would use. */

const IDENTITY = { cc: '+20', phone: '1001234567' };

/** A registered player with the coach card already dismissed. */
const seedPlayer = (page) =>
  page.addInitScript((id) => {
    localStorage.setItem('mcslice.identity.v1', JSON.stringify(id));
    localStorage.setItem('mcslice.coached.v1', '1');
    localStorage.setItem(
      'mcslice.v1',
      JSON.stringify({
        profile: { id: 'p_test', name: 'Ahmed Testperson', isGuest: false },
        progress: {
          rewardPoints: 1200,
          bestScore: 9000,
          lastScore: 0,
          gamesPlayed: 3,
          redeemedRewardIds: [],
          lastRun: null,
        },
        settings: { soundEnabled: false, reducedMotion: true },
      }),
    );
  }, IDENTITY);

/**
 * Collect every event the page emits.
 *
 * Installed via `setSink` on the module the app already imports, so this
 * observes exactly what a real vendor would receive — not a parallel path.
 */
async function collect(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__events = [];
    /* Imported by URL because this runs IN the page, where the module is served
       over HTTP rather than resolved from disk. Attached through setSink — the
       same public seam a real vendor would use — so this observes exactly what a
       vendor would receive rather than a parallel path. */
    const url = '/src/analytics/index.js';
    import(url).then((mod) => mod.setSink((e) => w.__events.push(e))).catch(() => {});
  });
}

const events = (page) => page.evaluate(() => /** @type {any} */ (window).__events ?? []);
const names = async (page) => (await events(page)).map((e) => e.name);

test.describe('the journey emits the expected events', () => {
  test.beforeEach(async ({ page }) => {
    await collect(page);
  });

  test('campaign entry is tracked', async ({ page }) => {
    await page.goto('/index.html#/');
    await expect.poll(() => names(page)).toContain('campaign_viewed');
  });

  test('starting a round tracks whether it can pay out', async ({ page }) => {
    await seedPlayer(page);
    await page.route('**/api/start-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          granted: true,
          token: '11111111-2222-3333-4444-555555555555',
        }),
      }),
    );
    await page.goto('/index.html#/play');
    await expect.poll(() => names(page)).toContain('game_started');

    const started = (await events(page)).find((e) => e.name === 'game_started');
    // Rewardable is the dimension that splits practice traffic from prize
    // traffic, so it must actually be populated rather than defaulted.
    expect(started.props.rewardable).toBe(true);
    expect(started.props.roundSeconds).toBe(30);
    expect(started.props.lives).toBe(2);
  });

  test('a practice round is tracked as not rewardable', async ({ page }) => {
    // No identity seeded, so startRound() never even calls the API.
    await page.addInitScript(() => localStorage.setItem('mcslice.coached.v1', '1'));
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: /play now/i }).click();
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
    await expect.poll(() => names(page)).toContain('game_started');
    const started = (await events(page)).find((e) => e.name === 'game_started');
    expect(started.props.rewardable).toBe(false);
  });

  test('verification start and completion are tracked without the number', async ({ page }) => {
    await page.goto('/index.html#/sign-in');
    await expect.poll(() => names(page)).toContain('verification_started');

    await page.getByRole('button', { name: /continue as guest/i }).click();
    await expect.poll(() => names(page)).toContain('verification_completed');

    const all = JSON.stringify(await events(page));
    expect(all).not.toContain('1001234567');
  });

  test('the how-to-play card is tracked', async ({ page }) => {
    await page.addInitScript((id) => {
      localStorage.setItem('mcslice.identity.v1', JSON.stringify(id));
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'p', name: 'P', isGuest: false },
          progress: {
            rewardPoints: 0,
            bestScore: 0,
            lastScore: 0,
            gamesPlayed: 0,
            redeemedRewardIds: [],
            lastRun: null,
          },
          settings: { soundEnabled: false, reducedMotion: true },
        }),
      );
    }, IDENTITY);
    await page.goto('/index.html#/play');
    await expect.poll(() => names(page)).toContain('instructions_viewed');
  });

  test('pause and resume are tracked', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /pause/i }).click();
    await expect.poll(() => names(page)).toContain('game_paused');
    await page.getByRole('button', { name: /resume|متابعة/i }).click();
    await expect.poll(() => names(page)).toContain('game_resumed');
  });

  test('a loss tracks game_lost, not game_won', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    await page.waitForTimeout(600);
    await page.evaluate(() => window.UI.showTryAgain(1234, 0, null, false));
    await expect.poll(() => names(page)).toContain('game_lost');
    expect(await names(page)).not.toContain('game_won');
  });

  test('a win tracks game_won and the reward outcome separately', async ({ page }) => {
    // Two events because they answer two different questions: a survivor who
    // still got nothing must be visible in the funnel.
    await seedPlayer(page);
    await page.route('**/api/start-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          granted: true,
          token: '11111111-2222-3333-4444-555555555555',
        }),
      }),
    );
    await page.route('**/api/submit-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          won: true,
          prize: { key: 'fries', label: 'Free Fries' },
          orderPoints: 1000,
          pointsThreshold: 4000,
        }),
      }),
    );
    await page.goto('/index.html#/play');
    await page.waitForTimeout(800);
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(42000, 30000, {
        survived: true,
        outcome: 'survived',
        itemsSliced: 61,
        bestCombo: 7,
      });
      window.UI.showChooser(42000, r);
    });

    await expect.poll(() => names(page)).toContain('game_won');
    await expect.poll(() => names(page)).toContain('reward_issued');

    const issued = (await events(page)).find((e) => e.name === 'reward_issued');
    expect(issued.props.prizeKey).toBe('fries');
  });

  test('a survivor who is not eligible tracks reward_eligible, not reward_issued', async ({
    page,
  }) => {
    await seedPlayer(page);
    await page.route('**/api/start-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          granted: true,
          token: '11111111-2222-3333-4444-555555555555',
        }),
      }),
    );
    await page.route('**/api/submit-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, won: false, orderPoints: 1200, pointsThreshold: 4000 }),
      }),
    );
    await page.goto('/index.html#/play');
    await page.waitForTimeout(800);
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(42000, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(42000, r);
    });

    await expect.poll(() => names(page)).toContain('reward_eligible');
    expect(await names(page)).not.toContain('reward_issued');
  });

  test('the leaderboard view is tracked', async ({ page }) => {
    await page.goto('/index.html#/leaderboard');
    await expect.poll(() => names(page)).toContain('leaderboard_viewed');
  });
});

test.describe('nothing sensitive is ever transmitted', () => {
  test('no phone number, player name, token or device id appears in any event', async ({
    page,
  }) => {
    await collect(page);
    await seedPlayer(page);
    await page.route('**/api/start-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, granted: true, token: 'SECRET-TOKEN-VALUE' }),
      }),
    );
    await page.route('**/api/submit-run', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          won: true,
          prize: { key: 'bigmac', label: 'Free Big Mac®' },
          code: 'MC-SECRET-CODE',
          orderPoints: 5000,
          pointsThreshold: 4000,
        }),
      }),
    );

    // Walk a full journey so as many call sites as possible fire.
    await page.goto('/index.html#/');
    await page.goto('/index.html#/play');
    await page.waitForTimeout(800);
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(42000, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(42000, r);
    });
    await page.goto('/index.html#/wallet');
    await page.goto('/index.html#/leaderboard');

    const dump = JSON.stringify(await events(page));
    expect(dump.length).toBeGreaterThan(2); // sanity: events were actually captured

    for (const secret of [
      '1001234567', // phone
      'Ahmed Testperson', // player name
      'SECRET-TOKEN-VALUE', // session token
      'MC-SECRET-CODE', // prize code — a bearer token
    ]) {
      expect(dump, `leaked: ${secret}`).not.toContain(secret);
    }
  });

  test('every emitted event is a known name', async ({ page }) => {
    // A typo'd name would be rejected by track() and vanish; this proves the
    // call sites are all using the taxonomy.
    await collect(page);
    await seedPlayer(page);
    await page.goto('/index.html#/');
    await page.goto('/index.html#/play');
    await page.waitForTimeout(600);

    const unknown = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      const url = '/src/analytics/index.js';
      const mod = await import(url);
      return (w.__events ?? []).map((e) => e.name).filter((n) => !mod.isKnownEvent(n));
    });
    expect(unknown).toEqual([]);
  });

  test('analytics failure cannot break gameplay', async ({ page }) => {
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__events = [];
      const url = '/src/analytics/index.js';
      import(url)
        .then((mod) =>
          // A vendor that throws on every event.
          mod.setSink(() => {
            throw new Error('vendor exploded');
          }),
        )
        .catch(() => {});
    });
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    // The round still mounts and the HUD still renders.
    await expect(page.locator('.hud__score')).toHaveCount(1);
    await expect(page.locator('#game')).toBeVisible();
  });
});
