import { test, expect } from '@playwright/test';

/* One static build, many restaurants (ADR 0018).
 *
 * The site root is the McDonald's build and must behave exactly as before;
 * /play/<slug>/ boots a different restaurant from its own manifest. These run
 * against the dev server, which serves /play/<slug>/ the way vercel.json does
 * and keeps a separate in-memory backend per tenant (dev_api.py) — so two
 * tenants really are live at once, in one browser, on every viewport project.
 *
 * What this proves is the CLIENT half: the right skin, no flash of another
 * brand, namespaced storage, and the tenant on every API call. The database
 * half behind the real API is proved in tests/integration/. */

const DEMO = 'demo-diner'; // campaigns/example-reskin.json
const DEMO_PRIZES = ['Free Chips', 'Free Thick Shake', 'Free House Burger'];

/** A registered, non-guest player under a tenant's storage keys (null = root). */
async function seedPlayer(page, { tenant = null, phone = '1001234567' } = {}) {
  await page.addInitScript(
    ([tenant, phone]) => {
      const key = (base) => (tenant ? `${base}@${tenant}` : base);
      localStorage.setItem(key('mcslice.identity.v1'), JSON.stringify({ cc: '+20', phone }));
      localStorage.setItem(key('mcslice.coached.v1'), '1');
      localStorage.setItem(
        key('mcslice.v1'),
        JSON.stringify({
          profile: { id: 'p_test', name: 'Youssef', isGuest: false },
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
    [tenant, phone],
  );
}

/** The X-Tenant header of every reward API call the page makes. */
function recordTenantHeaders(page) {
  /** @type {(string|null)[]} */
  const seen = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/api/') && pathname !== '/api/tenant-config') {
      seen.push(r.headers()['x-tenant'] ?? null);
    }
  });
  return seen;
}

const isTenantConfig = (slug, { preview = false } = {}) => (url) =>
  url.pathname === '/api/tenant-config' &&
  url.searchParams.get('slug') === slug &&
  url.searchParams.has('preview') === preview;

test.describe('the site root', () => {
  test('is still the McDonald’s build, with no tenant on the wire and its original storage keys', async ({
    page,
  }) => {
    await seedPlayer(page);
    const tenants = recordTenantHeaders(page);
    await page.goto('/index.html#/');
    expect(await page.evaluate(() => window.BRAND.name)).toBe("McDonald's");

    await page.getByRole('button', { name: /play now/i }).click();
    await expect(page).toHaveURL(/#\/play$/);
    await expect.poll(() => tenants.length).toBeGreaterThan(0);
    expect(new Set(tenants)).toEqual(new Set([null]));

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((k) => k.includes('@'))).toEqual([]);
  });
});

test.describe('a tenant page', () => {
  test('boots its own skin, and never paints McDonald’s first', async ({ page }) => {
    await page.addInitScript(() => {
      /** @type {any} */ (window).__leaks = [];
      new MutationObserver(() => {
        const text = document.getElementById('route')?.innerText ?? '';
        if (/McSlice|McDonald/i.test(text)) /** @type {any} */ (window).__leaks.push(text.slice(0, 80));
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });

    await page.goto(`/play/${DEMO}/#/`);
    await expect(page.getByRole('button', { name: /play now/i })).toBeVisible();

    const cfg = await page.evaluate(() => ({
      name: window.BRAND.name,
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
      title: document.title,
      primary: getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim(),
      leaks: /** @type {any} */ (window).__leaks,
      bootLogo: document.querySelector('#boot img') !== null,
    }));
    expect(cfg).toEqual({
      name: 'Demo Diner',
      round: 45,
      lives: 3,
      title: 'Diner Dash Slice',
      primary: '#00653A',
      leaks: [],
      bootLogo: false,
    });
  });

  test('is reachable without the trailing slash', async ({ page }) => {
    await page.goto(`/play/${DEMO}`);
    await expect(page).toHaveURL(new RegExp(`/play/${DEMO}/`));
    await expect(page.getByRole('button', { name: /play now/i })).toBeVisible();
    expect(await page.evaluate(() => window.BRAND.name)).toBe('Demo Diner');
  });

  test('ignores ?campaign= — its skin comes only from its own manifest', async ({ page }) => {
    await page.goto(`/play/${DEMO}/?campaign=mcdonalds#/`);
    await expect(page.getByRole('button', { name: /play now/i })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.BRAND.name)).toBe('Demo Diner');
  });
});

test.describe('two tenants at once', () => {
  test('side by side in one browser, each keeps its own player and storage', async ({ context }) => {
    const root = await context.newPage();
    await root.goto('/index.html#/');
    await root.evaluate(() =>
      localStorage.setItem('mcslice.identity.v1', JSON.stringify({ cc: '+20', phone: '1005550000' })),
    );

    const demo = await context.newPage();
    await demo.goto(`/play/${DEMO}/#/`);
    await demo.getByRole('button', { name: /play now/i }).click();
    // The root page's stored number must not sign this tenant's page in.
    await expect(demo).toHaveURL(/#\/sign-in$/);
    await demo.locator('.signin__phone-input').fill('01007770000');
    await demo.getByRole('button', { name: /^play$/i }).click();
    await expect(demo).toHaveURL(/#\/play$/);

    const storage = await demo.evaluate(() =>
      Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
    );
    // The tenant page wrote only its own keys…
    expect(storage[`mcslice.identity.v1@${DEMO}`]).toContain('1007770000');
    expect(storage[`mcslice.v1@${DEMO}`]).toContain('Player 0000');
    // …and left the root page's player exactly as it was.
    expect(storage['mcslice.identity.v1']).toContain('1005550000');
    expect(storage['mcslice.identity.v1']).not.toContain('1007770000');

    expect(await root.evaluate(() => window.BRAND.name)).toBe("McDonald's");
    expect(await demo.evaluate(() => window.BRAND.name)).toBe('Demo Diner');
  });

  test('played at the same time by the same phone, each reaches its own backend and prizes', async ({
    browser,
  }, testInfo) => {
    /* One dev backend serves every viewport project in parallel, and a win locks
       a phone out for hours. So the phone is shared by the two tenants in THIS
       run — the point of the test — but not with the other projects' runs. */
    const phone = `100${String(testInfo.parallelIndex).padStart(2, '0')}${String(Date.now()).slice(-5)}`;
    const play = async (tenant) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await seedPlayer(page, { tenant, phone });
      const tenants = recordTenantHeaders(page);
      await page.goto(tenant ? `/play/${tenant}/#/` : '/index.html#/');
      await page.getByRole('button', { name: /play now/i }).click();
      await expect(page).toHaveURL(/#\/play$/);
      await expect(page.locator('.game-stake')).not.toHaveText('');

      /* The round clock cannot run to a real finish in headless Chromium (see
         reward-authority.spec.js), so this submits through the real service
         exactly as the engine's endGame() does on a survival. */
      const submitted = page.waitForResponse((r) => r.url().endsWith('/api/submit-run'));
      await page.evaluate(() =>
        window.LoyaltyData.submitRun(9000, 46000, {
          survived: true,
          outcome: 'survived',
          livesRemaining: 1,
          itemsSliced: 20,
        }),
      );
      const body = await (await submitted).json();
      await context.close();
      return { body, tenants };
    };

    const [root, demo] = await Promise.all([play(null), play(DEMO)]);

    expect(new Set(root.tenants)).toEqual(new Set([null]));
    expect(new Set(demo.tenants)).toEqual(new Set([DEMO]));

    expect(root.body).toMatchObject({ won: true, pointsThreshold: 4000 });
    expect(root.body.code).toMatch(/^MC-/);
    expect(demo.body).toMatchObject({ won: true, pointsThreshold: 1500 });
    expect(demo.body.code).toMatch(/^DD-/);
    expect(DEMO_PRIZES).toContain(demo.body.prize.label);
    // Each started from its own fresh balance: neither saw the other's spend.
    expect(root.body.orderPoints).toBe(200);
    expect(demo.body.orderPoints).toBe(2700);
  });
});

test.describe('a tenant that cannot be served', () => {
  test('says the game is unavailable — it never falls back to another brand', async ({ page }) => {
    const tenants = recordTenantHeaders(page);
    await page.goto('/play/ghost-brand/#/');

    await expect(page.locator('.tenant-unavailable')).toBeVisible();
    await expect(page.locator('#route')).not.toContainText(/McSlice|McDonald/i);
    await expect(page.getByRole('button', { name: /play now/i })).toHaveCount(0);
    await expect(page.locator('#boot')).toHaveCount(0);
    expect(await page.title()).not.toMatch(/McSlice/i);
    expect(tenants).toEqual([]);
  });

  test('refuses a manifest that describes a different brand than the URL', async ({ page }) => {
    const published = await (await page.request.get(`/api/tenant-config?slug=${DEMO}`)).json();
    await page.route(isTenantConfig('acme-burger'), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(published) }),
    );
    await page.goto('/play/acme-burger/#/');
    await expect(page.locator('.tenant-unavailable')).toBeVisible();
    expect(await page.evaluate(() => window.BRAND.name)).not.toBe('Demo Diner');
  });
});

test.describe('an ops preview', () => {
  test('plays the draft with rewards switched off', async ({ page }) => {
    const published = await (await page.request.get(`/api/tenant-config?slug=${DEMO}`)).json();
    const manifest = {
      ...published.manifest,
      brand: { ...published.manifest.brand, id: 'draft-cafe', name: 'Draft Cafe', gameName: 'Draft Rush' },
    };
    await page.route(isTenantConfig('draft-cafe', { preview: true }), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, preview: true, manifest }),
      }),
    );
    await seedPlayer(page, { tenant: 'draft-cafe' });
    const rewardCalls = [];
    page.on('request', (r) => {
      if (/\/api\/(register|start-run|submit-run|session-status)$/.test(new URL(r.url()).pathname)) {
        rewardCalls.push(r.url());
      }
    });

    await page.goto('/play/draft-cafe/?preview=signed-token#/');
    await expect(page.locator('.preview-bar')).toBeVisible();
    expect(await page.evaluate(() => [window.BRAND.name, window.CONFIG.API.enabled])).toEqual([
      'Draft Cafe',
      false,
    ]);

    await page.getByRole('button', { name: /play now/i }).click();
    await expect(page).toHaveURL(/#\/play$/);
    await page.waitForTimeout(800);
    expect(rewardCalls).toEqual([]);
  });
});
