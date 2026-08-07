import { test, expect } from '@playwright/test';

/* Proves the reward path is server-authoritative in the REAL app, not just in
   unit tests: the backend is stubbed at the network boundary with
   `page.route`, so these specs exercise the actual pages, the actual engine
   and the actual service layer.

   The regression they exist to prevent is audit finding S1 — the shipped
   client used to compute `won = score >= 15000` in the browser and never made
   a network call at all, so a reward screen could appear with no server
   involvement whatsoever. */

const IDENTITY_KEY = 'mcslice.identity.v1';
const TOKEN = '11111111-2222-3333-4444-555555555555';

/**
 * A genuinely registered player: both the loyalty identity (the phone the
 * server attributes rounds to) and the local profile that /play is guarded on.
 *
 * Seeding BOTH matters. Seeding only the identity sends the flow through
 * "Continue as guest", and a guest deliberately has no identity — the guest
 * button clears it, because a guest round must be a practice round rather than
 * one silently credited to whoever last used the device. So an identity-only
 * fixture produced an unrewardable round and the reward assertions could never
 * pass.
 */
async function seedIdentity(page) {
  await page.addInitScript(
    ([idKey]) => {
      localStorage.setItem(idKey, JSON.stringify({ cc: '+20', phone: '1001234567' }));
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'p_test', name: 'Player 4567', isGuest: false },
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
    },
    [IDENTITY_KEY],
  );
}

/** Record every API call so we can assert on what the client actually sent. */
function trackCalls(page) {
  /** @type {{path:string, body:any}[]} */
  const calls = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) {
      let body = null;
      try {
        body = JSON.parse(req.postData() || 'null');
      } catch {
        /* non-JSON body */
      }
      calls.push({ path: url.pathname, body });
    }
  });
  return calls;
}

const jsonRoute =
  (payload, status = 200) =>
  (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

/**
 * Grant a round, then answer submit-run however the test needs.
 * @param {import('@playwright/test').Page} page
 * @param {{submit?: any, submitStatus?: number, grant?: boolean}} [opts]
 */
async function stubBackend(page, { submit, submitStatus = 200, grant = true } = {}) {
  await page.route('**/api/start-run', jsonRoute({ ok: true, granted: grant, token: TOKEN }));
  if (submit !== undefined) {
    await page.route('**/api/submit-run', jsonRoute(submit, submitStatus));
  }
}

/** Open the play route so startRound() runs and a real session exists. */
async function enterRound(page) {
  await page.goto('/index.html#/');
  await page.getByRole('button', { name: /play now/i }).click();
  if (/#\/sign-in$/.test(page.url())) {
    await page.getByRole('button', { name: /continue as guest/i }).click();
  }
  await expect(page).toHaveURL(/#\/play$/);
  await page.locator('#game').waitFor({ state: 'attached' });
  // Let startRound() settle so the token is available to submit.
  await expect(page.locator('.game-stake')).not.toHaveText('');
}

/**
 * Finish the round as a survivor and let the UI react.
 *
 * The engine cannot be run to a real 30-second finish here: headless Chromium
 * throttles requestAnimationFrame to roughly 1.3fps in this harness, and the
 * loop clamps each frame's delta to 50ms, so 30s of round time would need
 * about eight minutes of wall clock. Waiting for the clock is therefore not an
 * option, and forcing `Game.endGame()` early is worse than useless — it
 * correctly resolves an early finish as ELIMINATED, which never submits.
 *
 * So this replays exactly what the engine's own endGame() does on a survival:
 * submit through the real LoyaltyData adapter (real service, real fetch, real
 * store), then hand the result to the real UI bridge, which emits the same
 * 'ended' event play.js listens for. Everything downstream of the round clock
 * is genuine; only the clock itself is short-circuited. The clock and the
 * survival rule are covered deterministically in tests/unit/round-rules.js.
 */
async function finishRoundAsSurvivor(page, { score = 42000, durationMs = 30000 } = {}) {
  await enterRound(page);
  await page.evaluate(
    async ([score, durationMs]) => {
      const result = await window.LoyaltyData.submitRun(score, durationMs, {
        survived: true,
        outcome: 'survived',
        livesRemaining: 2,
        itemsSliced: 61,
      });
      window.UI.showChooser(score, result);
    },
    [score, durationMs],
  );
  await expect(page).toHaveURL(/#\/win$/);
}

test.describe('the client never fabricates a reward', () => {
  test.beforeEach(async ({ page }) => {
    await seedIdentity(page);
  });

  test('a server denial shows no prize', async ({ page }) => {
    await stubBackend(page, {
      submit: {
        ok: true,
        won: false,
        survived: true,
        gap: 2800,
        orderPoints: 1200,
        pointsThreshold: 4000,
      },
    });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel')).toBeVisible();
    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--not_eligible/);
    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
    await expect(page.locator('.reward-panel')).toContainText(/more to unlock/i);
  });

  test('a 500 shows no prize', async ({ page }) => {
    await stubBackend(page, { submit: { ok: false, error: 'server_error' }, submitStatus: 500 });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--error/);
    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
    await expect(page.locator('.reward-panel')).toContainText(/no prize has been issued/i);
  });

  test('a network failure shows no prize', async ({ page }) => {
    await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
    await page.route('**/api/submit-run', (route) => route.abort('failed'));
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--pending/);
    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
  });

  test('a malformed body shows no prize', async ({ page }) => {
    await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
    await page.route('**/api/submit-run', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not json at all' }),
    );
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
  });

  test('"won" with no prize object shows no prize', async ({ page }) => {
    // A server contract violation must fail closed, not render a blank prize.
    await stubBackend(page, {
      submit: { ok: true, won: true, orderPoints: 5000, pointsThreshold: 4000 },
    });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--error/);
  });

  test('a flagged run shows no prize', async ({ page }) => {
    await stubBackend(page, {
      submit: {
        ok: true,
        won: true,
        suspicious: true,
        prize: { key: 'bigmac', label: 'Free Big Mac®' },
      },
    });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--flagged/);
    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Free Big Mac');
  });

  test('an explicit server award — and only that — shows the prize', async ({ page }) => {
    await stubBackend(page, {
      submit: {
        ok: true,
        won: true,
        prize: { key: 'fries', label: 'Free Fries' },
        prizeIndex: 1,
        orderPoints: 1000,
        pointsThreshold: 4000,
      },
    });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel')).toHaveClass(/reward-panel--awarded/);
    await expect(page.locator('.reward-panel__prize')).toHaveText('Free Fries');
  });

  test("the prize shown is the server's, not the client's idea of one", async ({ page }) => {
    await stubBackend(page, {
      submit: { ok: true, won: true, prize: { key: 'hashbrown', label: 'Free Hash Brown' } },
    });
    await finishRoundAsSurvivor(page);

    await expect(page.locator('.reward-panel__prize')).toHaveText('Free Hash Brown');
    // Not the rarest/first prize from the client's own CONFIG.WHEEL.
    await expect(page.locator('.reward-panel__prize')).not.toHaveText(/big mac/i);
  });
});

test.describe('session and submission discipline', () => {
  test.beforeEach(async ({ page }) => {
    await seedIdentity(page);
  });

  test('a round is authorised by the server before it can pay out', async ({ page }) => {
    const calls = trackCalls(page);
    await stubBackend(page, { submit: { ok: true, won: false } });
    await finishRoundAsSurvivor(page);

    const paths = calls.map((c) => c.path);
    expect(paths).toContain('/api/start-run');
    expect(paths).toContain('/api/submit-run');
    // start-run must come first: submit-run needs the token it issues.
    expect(paths.indexOf('/api/start-run')).toBeLessThan(paths.indexOf('/api/submit-run'));
  });

  test('the submission carries the server-issued token', async ({ page }) => {
    const calls = trackCalls(page);
    await stubBackend(page, { submit: { ok: true, won: false } });
    await finishRoundAsSurvivor(page);

    const submit = calls.find((c) => c.path === '/api/submit-run');
    expect(submit).toBeTruthy();
    expect(submit.body.token).toBe(TOKEN);
    expect(typeof submit.body.durationMs).toBe('number');
    expect(typeof submit.body.device).toBe('string');
  });

  test('one round submits exactly once, even if round-end fires twice', async ({ page }) => {
    const calls = trackCalls(page);
    await stubBackend(page, { submit: { ok: true, won: false } });
    await finishRoundAsSurvivor(page);

    // Re-fire the round-end path; the consumed token must block a second ask.
    await page.evaluate(async () => {
      await window.LoyaltyData.submitRun(999999, 30000, { survived: true, outcome: 'survived' });
    });
    await page.waitForTimeout(300);

    const submits = calls.filter((c) => c.path === '/api/submit-run');
    expect(submits.length).toBe(1);
  });

  test('with no identity the round is labelled practice and never submits', async ({ page }) => {
    // No seedIdentity here on purpose.
    await page.addInitScript((key) => localStorage.removeItem(key), IDENTITY_KEY);
    const calls = trackCalls(page);
    await finishRoundAsSurvivor(page);

    expect(calls.filter((c) => c.path === '/api/start-run').length).toBe(0);
    expect(calls.filter((c) => c.path === '/api/submit-run').length).toBe(0);
    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
  });

  test('an unauthorised round is labelled practice in-round, before the player commits', async ({
    page,
  }) => {
    await seedIdentity(page);
    await page.route(
      '**/api/start-run',
      jsonRoute({ ok: true, granted: false, reason: 'locked_win', nextPlayAt: null }),
    );
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: /play now/i }).click();
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
    await expect(page.locator('.game-stake')).toContainText(/practice round/i);
  });
});

test.describe('client-side value creation is closed off', () => {
  test('gameplay does not mint spendable points', async ({ page }) => {
    await seedIdentity(page);
    await stubBackend(page, {
      submit: { ok: true, won: false, orderPoints: 0, pointsThreshold: 4000 },
    });

    await page.goto('/index.html#/');
    await page.getByRole('button', { name: /play now/i }).click();
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
    await page.locator('#game').waitFor({ state: 'attached' });

    const before = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return raw?.progress?.rewardPoints ?? 0;
    });

    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      await window.Game.endGame();
    });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return raw?.progress?.rewardPoints ?? 0;
    });

    // Used to grow by floor(score / 10) per round, minted in the browser and
    // spendable on real products in the rewards catalogue.
    expect(after).toBeLessThanOrEqual(before);
  });

  test('the rewards catalogue refuses to grant value client-side', async ({ page }) => {
    await page.addInitScript(() => {
      // Even with a large local balance, redemption must not succeed.
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'p_test', name: 'Tester', isGuest: true },
          progress: {
            rewardPoints: 999999,
            bestScore: 0,
            lastScore: 0,
            gamesPlayed: 0,
            redeemedRewardIds: [],
            lastRun: null,
          },
          settings: { soundEnabled: false, reducedMotion: true },
        }),
      );
    });
    await page.goto('/index.html#/rewards');

    // With a huge local balance every card reads as affordable, which is the
    // point: affordability is a client-side judgement and must not be
    // sufficient to actually obtain anything.
    const firstCard = page.locator('.reward:not([disabled])').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    // Confirm the redemption through the real modal.
    await page.getByRole('button', { name: /yes, redeem/i }).click();

    // The attempt is refused, and says so.
    await expect(page.locator('.toast')).toContainText(/counter only|unavailable/i);

    // Nothing was granted: no reward marked owned, balance untouched.
    const after = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return {
        owned: raw?.progress?.redeemedRewardIds ?? [],
        points: raw?.progress?.rewardPoints ?? 0,
      };
    });
    expect(after.owned).toEqual([]);
    expect(after.points).toBe(999999);
    await expect(page.locator('.reward--owned')).toHaveCount(0);
  });
});
