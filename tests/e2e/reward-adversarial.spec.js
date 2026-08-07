import { test, expect } from '@playwright/test';

/* Adversarial pass over the reward path — actual exploit attempts against the
   running app, per CLAUDE.md's Definition of Done for reward-touching changes.

   Scope and honesty about it: these attack the CLIENT and the wire format.
   They prove the browser cannot manufacture a reward. They do NOT prove the
   server's own guarantees (row locking, one-time token consumption, campaign
   budget), because no Supabase instance is reachable from this environment —
   those need integration tests against a real database and are listed as
   outstanding in the Stage 4 ADR. */

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

const jsonRoute =
  (payload, status = 200) =>
  (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

/** Server that grants rounds but always denies a prize. */
async function denyingBackend(page, calls) {
  await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
  await page.route('**/api/submit-run', (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'));
    return jsonRoute({
      ok: true,
      won: false,
      survived: true,
      orderPoints: 10,
      pointsThreshold: 4000,
    })(route);
  });
}

async function enterRound(page) {
  await page.goto('/index.html#/');
  await page.getByRole('button', { name: /play now/i }).click();
  if (/#\/sign-in$/.test(page.url())) {
    await page.getByRole('button', { name: /continue as guest/i }).click();
  }
  await expect(page).toHaveURL(/#\/play$/);
  await expect(page.locator('.game-stake')).not.toHaveText('');
}

test.describe('fake wins', () => {
  test.beforeEach(async ({ page }) => seedIdentity(page));

  test('an absurd score does not produce a prize', async ({ page }) => {
    const submissions = [];
    await denyingBackend(page, submissions);
    await enterRound(page);

    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(Number.MAX_SAFE_INTEGER, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(999, r);
    });

    await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
    // The score is forwarded for the server to judge, not acted on locally.
    expect(submissions.length).toBe(1);
  });

  test('claiming survival on an eliminated round never even submits', async ({ page }) => {
    const submissions = [];
    await denyingBackend(page, submissions);
    await enterRound(page);

    await page.evaluate(async () => {
      // Contradictory input: outcome says eliminated, flag says survived.
      await window.LoyaltyData.submitRun(50000, 30000, {
        survived: false,
        outcome: 'eliminated',
      });
    });
    await page.waitForTimeout(250);
    expect(submissions.length).toBe(0);
  });

  test('forging the round result object does not produce a prize', async ({ page }) => {
    await denyingBackend(page, []);
    await enterRound(page);

    // Hand the UI a fabricated "win" with a fabricated prize, as a tampering
    // script would. The result screen renders only Store.lastReward(), which is
    // set from the SERVER's reward outcome — not from this object.
    await page.evaluate(() => {
      window.UI.showChooser(999999, {
        won: true,
        survived: true,
        reward: {
          status: 'awarded',
          awarded: true,
          prize: { key: 'bigmac', label: 'FORGED Big Mac' },
          title: 'You won!',
          message: 'FORGED Big Mac',
          orderPoints: 99999,
          pointsThreshold: 4000,
          retryable: false,
        },
      });
    });

    await expect(page).toHaveURL(/#\/win$/);
    // This is the one place a forged object CAN reach the screen, because
    // play.js trusts the bridge it is wired to. Documented deliberately: the
    // defence is that the real backend never issued a code, so the prize is
    // not redeemable — the audit trail lives in wheel_wins, not the DOM.
    // What must NOT happen is any durable grant.
    const persisted = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return {
        owned: raw?.progress?.redeemedRewardIds ?? [],
        points: raw?.progress?.rewardPoints ?? 0,
      };
    });
    expect(persisted.owned).toEqual([]);
    expect(persisted.points).toBe(0);
  });
});

test.describe('session replay and reuse', () => {
  test.beforeEach(async ({ page }) => seedIdentity(page));

  test('a token cannot be submitted twice from the client', async ({ page }) => {
    const submissions = [];
    await denyingBackend(page, submissions);
    await enterRound(page);

    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        await window.LoyaltyData.submitRun(1000 * i, 30000, {
          survived: true,
          outcome: 'survived',
        });
      }
    });

    expect(submissions.length).toBe(1);
  });

  test('concurrent submissions of one round yield one request', async ({ page }) => {
    const submissions = [];
    await denyingBackend(page, submissions);
    await enterRound(page);

    await page.evaluate(async () => {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          window.LoyaltyData.submitRun(30000, 30000, { survived: true, outcome: 'survived' }),
        ),
      );
    });

    // The consumed-flag is set synchronously before the await, so even a
    // simultaneous burst cannot get two requests out.
    expect(submissions.length).toBe(1);
  });

  test('leaving the round drops the token', async ({ page }) => {
    const submissions = [];
    await denyingBackend(page, submissions);
    await enterRound(page);

    await page.evaluate(() => {
      location.hash = '#/';
    });
    await expect(page).toHaveURL(/#\/$/);

    // A stale token must not be submittable after teardown.
    await page.evaluate(async () => {
      await window.LoyaltyData.submitRun(30000, 30000, { survived: true, outcome: 'survived' });
    });
    await page.waitForTimeout(250);
    expect(submissions.length).toBe(0);
  });
});

test.describe('response tampering', () => {
  test.beforeEach(async ({ page }) => seedIdentity(page));

  const hostileBodies = [
    [
      'a prize smuggled onto a denial',
      { ok: true, won: false, prize: { key: 'bigmac', label: 'Free Big Mac®' } },
    ],
    ['won as a truthy string', { ok: true, won: 'yes', prize: { key: 'x', label: 'Free Thing' } }],
    ['won as 1', { ok: true, won: 1, prize: { key: 'x', label: 'Free Thing' } }],
    ['a prize array', { ok: true, won: true, prize: [{ key: 'x', label: 'Free Thing' }] }],
    [
      'prototype pollution attempt',
      { ok: true, won: true, prize: { __proto__: { label: 'Free Thing' }, key: 'x' } },
    ],
    [
      'an envelope claiming failure but carrying a prize',
      { ok: false, won: true, prize: { key: 'x', label: 'Free Thing' } },
    ],
  ];

  for (const [name, body] of hostileBodies) {
    test(`${name} does not render a prize`, async ({ page }) => {
      await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
      await page.route('**/api/submit-run', jsonRoute(body));
      await enterRound(page);

      await page.evaluate(async () => {
        const r = await window.LoyaltyData.submitRun(40000, 30000, {
          survived: true,
          outcome: 'survived',
        });
        window.UI.showChooser(40000, r);
      });

      await expect(page.locator('.reward-panel__prize')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Free Thing');
      await expect(page.locator('body')).not.toContainText('Free Big Mac');
    });
  }
});

test.describe('no debug or cheat surface', () => {
  test('no cheat key credits points', async ({ page }) => {
    await seedIdentity(page);
    await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
    await enterRound(page);

    const before = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return raw?.progress?.rewardPoints ?? 0;
    });

    // The retired fastfood-ninja lineage shipped an 'O' key that credited +100
    // order points. Sweep the alphabet plus the documented dev params.
    for (const k of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      await page.keyboard.press(k);
    }
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return raw?.progress?.rewardPoints ?? 0;
    });
    expect(after).toBe(before);
  });

  test('dev query params do not grant points or rewards', async ({ page }) => {
    await seedIdentity(page);
    await page.route('**/api/start-run', jsonRoute({ ok: true, granted: true, token: TOKEN }));
    await page.goto('/index.html?play&dev&anyday&design=agency#/');

    const points = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('mcslice.v1') || '{}');
      return raw?.progress?.rewardPoints ?? 0;
    });
    expect(points).toBe(0);
  });

  test('the store exposes no local point-granting path', async ({ page }) => {
    await page.goto('/index.html#/');
    // grantPoints() was a test helper that incremented the spendable balance;
    // it is gone. setOrderPoints only mirrors a server figure and is not
    // reachable from the page without a module import.
    const reachable = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return { grantPoints: typeof w.Store?.grantPoints, store: typeof w.Store };
    });
    expect(reachable.store).toBe('undefined');
    expect(reachable.grantPoints).toBe('undefined');
  });
});
