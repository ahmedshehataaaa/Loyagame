import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/* Verifies the PRODUCTION build, not the source tree.
 *
 * A build script that emits files but produces a game that does not boot would
 * pass every other test in this suite, because everything else runs against the
 * unbundled source. These specs run against `dist/` on its own port.
 *
 * Requires `npm run build` first; skipped with a clear reason if dist/ is
 * absent, so a developer running the suite without building sees why rather
 * than hitting a confusing failure. */

const DIST = 'dist';
const PREVIEW = 'http://127.0.0.1:8767';
const built = existsSync(DIST) && existsSync(`${DIST}/index.html`);

test.describe('production build output', () => {
  test.skip(!built, 'dist/ not present — run `npm run build` first');

  test('emits content-hashed js and css', () => {
    // Hashing is the whole reason the build exists: without it a deploy cannot
    // be cache-busted, which is what forced the service worker to be
    // network-first for code (ADR 0013).
    const files = readdirSync(DIST);
    expect(files.some((f) => /^app\.[0-9a-f]{8}\.js$/.test(f))).toBe(true);
    expect(files.some((f) => /^app\.[0-9a-f]{8}\.css$/.test(f))).toBe(true);
    expect(files.some((f) => /^engine\.[0-9a-f]{8}\.js$/.test(f))).toBe(true);
  });

  test('index.html points at the hashed files, not the sources', () => {
    const raw = readFileSync(`${DIST}/index.html`, 'utf8');
    /* Comments are stripped first: an explanatory comment mentioning
       `src/main.js` is not a stale reference, and asserting on the raw text
       flagged one. What matters is the actual src/href attributes. */
    const html = raw.replace(/<!--[\s\S]*?-->/g, '');

    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(refs.some((r) => r.startsWith('src/'))).toBe(false);
    expect(refs.some((r) => r.startsWith('engine/'))).toBe(false);
    expect(refs.some((r) => /^app\.[0-9a-f]{8}\.js$/.test(r))).toBe(true);
    expect(refs.some((r) => /^app\.[0-9a-f]{8}\.css$/.test(r))).toBe(true);
    expect(refs.some((r) => /^engine\.[0-9a-f]{8}\.js$/.test(r))).toBe(true);
  });

  test('the service worker shell names files that exist', () => {
    /* The previous service worker listed the pre-refactor layout, and
       `cache.addAll()` rejects atomically on a single 404 — so it silently
       never installed. A shell entry absent from dist/ is that bug returning. */
    const sw = readFileSync(`${DIST}/sw.js`, 'utf8');
    const shellBlock = sw.slice(
      sw.indexOf('const SHELL = ['),
      sw.indexOf('];', sw.indexOf('const SHELL = [')),
    );
    const shell = [...shellBlock.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
    expect(shell.length).toBeGreaterThan(3);
    for (const entry of shell) {
      expect(existsSync(`${DIST}/${entry}`), `sw shell entry missing: ${entry}`).toBe(true);
    }
  });

  test('the app bundle is not bloated by an inlined sourcemap', () => {
    // It was: `sourcemap: true` with write:false inlines a base64 map, which
    // took the shipped bundle from 76 KB to 409 KB.
    const js = readdirSync(DIST).find((f) => /^app\.[0-9a-f]{8}\.js$/.test(f));
    const text = readFileSync(`${DIST}/${js}`, 'utf8');
    expect(text).not.toContain('sourceMappingURL=data:');
    expect(Buffer.byteLength(text)).toBeLessThan(200 * 1024);
  });

  test('ships no mockup images', () => {
    // ~1.19 MB of unreferenced pre-refactor mockups used to ride along.
    const assets = readdirSync(`${DIST}/assets`);
    for (const stale of [
      'desktop.jpg',
      'results.jpg',
      'rotate.jpg',
      'tutorial.jpg',
      'verify.jpg',
      'loading.jpg',
      'locked.jpg',
      'mascot.png',
    ]) {
      expect(assets, `stale asset shipped: ${stale}`).not.toContain(stale);
    }
  });

  test('ships the campaign manifests it needs to reskin', () => {
    expect(existsSync(`${DIST}/campaigns/mcdonalds.json`)).toBe(true);
  });
});

test.describe('the built game runs', () => {
  test.skip(!built, 'dist/ not present — run `npm run build` first');
  test.use({ baseURL: PREVIEW });

  test('boots to the welcome screen with no page errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/index.html#/');
    await expect(page.locator('.welcome')).toBeVisible();
    await expect(page.getByRole('button', { name: /play now/i })).toBeVisible();
    expect(errors, `page errors in the built bundle: ${errors.join(' | ')}`).toEqual([]);
  });

  test('loads far fewer files than the unbundled source', async ({ page }) => {
    const seen = new Set();
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin === PREVIEW) seen.add(u.pathname);
    });
    await page.goto('/index.html#/');
    await page.waitForLoadState('load');
    // The source tree needs ~50; a bundle should be a small fraction of that.
    expect(seen.size).toBeLessThan(20);
  });

  test('the engine still exposes its globals after concatenation', async ({ page }) => {
    // The engine files are classic scripts sharing top-level scope — game.js
    // reads SPECIALS straight out of config.js's scope. Bundling them as ES
    // modules would break that silently.
    await page.goto('/index.html#/');
    const globals = await page.evaluate(() => ({
      config: typeof window.CONFIG,
      game: typeof window.Game,
      platform: typeof window.Platform,
      specials: typeof window.SPECIALS,
      mechanics: typeof window.Mechanics,
      foods: Array.isArray(window.FOODS) ? window.FOODS.length : 0,
    }));
    expect(globals.config).toBe('object');
    expect(globals.game).toBe('object');
    expect(globals.platform).toBe('object');
    expect(globals.specials).toBe('object');
    expect(globals.mechanics).toBe('object');
    expect(globals.foods).toBeGreaterThan(0);
  });

  test('a round is playable and renders in the built bundle', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mcslice.coached.v1', '1'));
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: /play now/i }).click();
    if (/#\/sign-in$/.test(page.url())) {
      await page.getByRole('button', { name: /continue as guest/i }).click();
    }
    await expect(page).toHaveURL(/#\/play$/);
    await expect(page.locator('.hud__score')).toHaveCount(1);

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

  test('Arabic and RTL survive minification', async ({ page }) => {
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.welcome')).toContainText('العب');
  });

  test('the service worker registers in the built bundle', async ({ page }) => {
    // It was never registered at all before, so the PWA promise was empty.
    await page.goto('/index.html#/');
    await page.waitForLoadState('load');
    const registered = await page
      .waitForFunction(
        async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
        null,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    expect(registered).toBe(true);
  });
});
