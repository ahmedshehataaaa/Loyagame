import { test, expect } from '@playwright/test';

/* Proves the reskin promise: ONE engine, per-restaurant data.
 *
 * `campaigns/example-reskin.json` shares no code with the McDonald's build —
 * only the manifest shape. If these pass, a new restaurant is a JSON file plus
 * sprites rather than a fork, which is the entire commercial premise. */

const skipCoach = (page) =>
  page.addInitScript(() => localStorage.setItem('mcslice.coached.v1', '1'));

test.describe('default build', () => {
  test('uses the built-in McDonald’s config with no manifest', async ({ page }) => {
    await page.goto('/index.html#/');
    const cfg = await page.evaluate(() => ({
      name: window.BRAND.name,
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
      items: window.FOODS.length,
    }));
    expect(cfg.name).toBe("McDonald's");
    expect(cfg.round).toBe(30);
    expect(cfg.lives).toBe(2);
    expect(cfg.items).toBe(7);
  });
});

test.describe('a second campaign reskins the same engine', () => {
  test('brand, rules, items and prizes all come from the manifest', async ({ page }) => {
    await page.goto('/index.html?campaign=example-reskin#/');
    // The manifest is applied fire-and-forget so first paint is not blocked.
    await expect
      .poll(() => page.evaluate(() => window.BRAND.name), { timeout: 5000 })
      .toBe('Demo Diner');

    const cfg = await page.evaluate(() => ({
      gameName: window.BRAND.gameName,
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
      items: window.FOODS.map((f) => f.label),
      hazard: window.BOMB.label,
      threshold: window.CONFIG.WHEEL.pointsThreshold,
      wheelEnabled: window.CONFIG.WHEEL.enabled,
      prizes: window.CONFIG.WHEEL.prizes.map((p) => p.label),
    }));

    expect(cfg.gameName).toBe('Diner Dash Slice');
    // Different round rules entirely — 45s / 3 lives, not 30s / 2.
    expect(cfg.round).toBe(45);
    expect(cfg.lives).toBe(3);
    expect(cfg.items).toEqual(['House Burger', 'Thick Shake', 'Skin-On Chips']);
    expect(cfg.hazard).toBe('Scorched batch — avoid!');
    expect(cfg.threshold).toBe(1500);
    // A feature flag really disables the wheel.
    expect(cfg.wheelEnabled).toBe(false);
    expect(cfg.prizes).toEqual(['Free Chips', 'Free Thick Shake', 'Free House Burger']);
    // No McDonald's content leaks through.
    expect(cfg.items.join(' ')).not.toMatch(/big mac|mcflurry/i);
  });

  test('brand colours reach the CSS custom properties', async ({ page }) => {
    await page.goto('/index.html?campaign=example-reskin#/');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim(),
          ),
        { timeout: 5000 },
      )
      .toBe('#00653A');
  });

  test('the reskinned game is actually playable', async ({ page }) => {
    // A config swap that leaves the game unplayable would satisfy every
    // assertion above and still be worthless.
    await skipCoach(page);
    await page.goto('/index.html?campaign=example-reskin#/');
    await expect
      .poll(() => page.evaluate(() => window.BRAND.name), { timeout: 5000 })
      .toBe('Demo Diner');

    await page.getByRole('button', { name: /play now/i }).click();
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
    await expect(page).toHaveURL(/#\/play$/);

    // The HUD reflects the manifest's rules, not the built-in ones.
    await expect(page.locator('.hud__goal')).toHaveText(/45/);
    const hearts = await page.locator('.hud__lives').innerText();
    expect(hearts.replace(/[^❤]/g, '').length).toBe(3);

    // And the engine renders the manifest's sprites.
    const painted = await page.evaluate(async () => {
      const cv = /** @type {any} */ (document.getElementById('game'));
      const ctx = cv.getContext('2d');
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 24 && ++n > 30) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    });
    expect(painted).toBe(true);
  });
});

test.describe('a bad manifest fails closed', () => {
  test('an invalid manifest is rejected wholesale and the built-in config stands', async ({
    page,
  }) => {
    // A half-applied campaign is worse than none: it could pair one
    // restaurant's prizes with another's threshold.
    await page.route('**/campaigns/broken.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 1,
          brand: { id: 'broken', name: 'Broken', gameName: 'Broken' },
          rules: { roundSeconds: 45, lives: 3 },
          items: [{ id: 'x', label: 'X', img: 'x.png', points: 10, radius: 10 }],
          hazard: { id: 'h', img: 'h.png', radius: 10 },
          // Invalid: a prize with no label and no threshold.
          rewards: { prizes: [{ key: 'a', weight: 1 }] },
        }),
      }),
    );

    await page.goto('/index.html?campaign=broken#/');
    await page.waitForTimeout(1200);

    const cfg = await page.evaluate(() => ({
      name: window.BRAND.name,
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
    }));
    // Nothing from the broken manifest was applied — not even its valid parts.
    expect(cfg.name).toBe("McDonald's");
    expect(cfg.round).toBe(30);
    expect(cfg.lives).toBe(2);
  });

  test('a missing manifest leaves the game working', async ({ page }) => {
    await page.goto('/index.html?campaign=does-not-exist#/');
    await page.waitForTimeout(800);
    const name = await page.evaluate(() => window.BRAND.name);
    expect(name).toBe("McDonald's");
    await expect(page.getByRole('button', { name: /play now/i })).toBeVisible();
  });

  test('a campaign id that is not slug-safe is never fetched', async ({ page }) => {
    // Guards against a path-traversal style value reaching the fetch.
    const requests = [];
    page.on('request', (r) => {
      if (r.url().includes('campaigns/')) requests.push(r.url());
    });
    await page.goto('/index.html?campaign=../../etc/passwd#/');
    await page.waitForTimeout(600);
    expect(requests).toEqual([]);
  });
});
