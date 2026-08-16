import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ============================================================
   Viewport + leaderboard audit.

   Runs in its own Playwright project (`audit`) and drives its own viewports,
   because the six mobile projects in playwright.config.js cannot express
   "1440px desktop" — and repeating a desktop assertion under a project called
   `iphone-se-320` would be actively misleading.

   Checks (a)-(f) map one-to-one onto the audit brief; each test title carries
   its letter so a failure names the check it broke.
   ============================================================ */

const COACH_KEY = 'mcslice.coached.v1';

/** Seed a registered player so /play is reachable and the board has a YOU row. */
const seed = (page) =>
  page.addInitScript(
    ([coachKey]) => {
      localStorage.setItem(coachKey, '1');
      localStorage.setItem(
        'mcslice.identity.v1',
        JSON.stringify({ cc: '+20', phone: '1001234567' }),
      );
      localStorage.setItem(
        'mcslice.v1',
        JSON.stringify({
          profile: { id: 'p_audit', name: 'Salma', isGuest: false },
          progress: {
            rewardPoints: 1200,
            bestScore: 600000,
            lastScore: 0,
            gamesPlayed: 3,
            redeemedRewardIds: [],
            lastRun: null,
          },
          settings: { soundEnabled: false, reducedMotion: true },
        }),
      );
    },
    [COACH_KEY],
  );

/** The seeded rival names. The player's own name is real data, not seed data. */
const APPROVED = ['Ahmed', 'Meera', 'Jana', 'Youssef', 'Laila', 'Omar', 'Nour'];

/* Gamertag shapes: a trailing _digits suffix, or the food-pun vocabulary the
   board used to ship. Kept as a pattern rather than a fixed list so a NEW pun
   is caught too. */
const GAMERTAG = /(_\d+$|\d)|(king|fanatic|stacker|slicer|ninja|pounder|sauce|shake|mc[A-Z])/i;

/** Open the game with the desktop device gate bypassed. */
async function openPlay(page) {
  await seed(page);
  await page.goto('/index.html?play#/play');
  await page.locator('.game-stage.is-playing').waitFor({ state: 'visible', timeout: 15000 });
  // One frame for resize() to settle against the shell it measures.
  await page.waitForTimeout(250);
}

async function openLeaderboard(page) {
  await seed(page);
  await page.goto('/index.html#/leaderboard');
  await page.locator('.lb-list').waitFor({ state: 'visible', timeout: 15000 });
}

/** Geometry of the canvas, its shell, and the document, in one round trip. */
function measure(page) {
  return page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
    const shell = document.getElementById('app');
    const c = canvas.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    return {
      canvas: { x: c.x, y: c.y, w: c.width, h: c.height, right: c.right, bottom: c.bottom },
      shell: { x: s.x, y: s.y, w: s.width, h: s.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      backing: { w: canvas.width, h: canvas.height },
    };
  });
}

/** The shared bounds contract for (a) and (b). */
function assertWithinViewport(m, label) {
  // Never wider or taller than the window it is drawn into.
  expect(m.canvas.w, `${label}: canvas wider than viewport`).toBeLessThanOrEqual(m.viewport.w + 1);
  expect(m.canvas.h, `${label}: canvas taller than viewport`).toBeLessThanOrEqual(m.viewport.h + 1);

  // Fully on screen — no bleed past any edge.
  expect(m.canvas.x, `${label}: canvas starts left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(m.canvas.y, `${label}: canvas starts above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(m.canvas.right, `${label}: canvas overflows the right edge`).toBeLessThanOrEqual(
    m.viewport.w + 1,
  );
  expect(m.canvas.bottom, `${label}: canvas overflows the bottom edge`).toBeLessThanOrEqual(
    m.viewport.h + 1,
  );

  // The page itself must not scroll sideways.
  expect(m.scrollW, `${label}: document scrolls horizontally`).toBeLessThanOrEqual(
    m.viewport.w + 1,
  );

  // The regression that started this: the canvas must FILL the shell that
  // clips it. Sized to the window instead, it was several times the shell's
  // width and the player saw a cropped slice.
  expect(
    m.canvas.w,
    `${label}: canvas does not fill its shell (half-screen render)`,
  ).toBeGreaterThan(m.shell.w - 2);
  expect(m.canvas.w, `${label}: canvas exceeds its shell`).toBeLessThanOrEqual(m.shell.w + 1);
  expect(m.canvas.h, `${label}: canvas does not fill its shell`).toBeGreaterThan(m.shell.h - 2);

  // A backing store of zero means it never sized at all.
  expect(m.backing.w, `${label}: canvas has no backing store`).toBeGreaterThan(0);
  expect(m.backing.h, `${label}: canvas has no backing store`).toBeGreaterThan(0);
}

/* ---- (a) desktop --------------------------------------------------- */
test.describe('(a) desktop canvas bounds', () => {
  for (const width of [1440, 1920]) {
    test(`(a) canvas renders fully inside a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPlay(page);
      const m = await measure(page);
      assertWithinViewport(m, `${width}px`);

      // The shell is the centred phone frame, not a full-bleed column.
      expect(m.shell.w, `${width}px: shell should not span the desktop`).toBeLessThan(width * 0.6);
      const leftGap = m.shell.x;
      const rightGap = m.viewport.w - (m.shell.x + m.shell.w);
      expect(Math.abs(leftGap - rightGap), `${width}px: frame is not centred`).toBeLessThanOrEqual(
        2,
      );
    });
  }

  test('(a) tablet breakpoint stays within bounds', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPlay(page);
    assertWithinViewport(await measure(page), '768px tablet');
  });
});

/* ---- (b) mobile + safe area ---------------------------------------- */
test.describe('(b) mobile canvas bounds and safe area', () => {
  for (const { label, width, height } of [
    { label: 'iPhone 14', width: 390, height: 844 },
    { label: 'iPhone 15', width: 393, height: 852 },
  ]) {
    test(`(b) canvas renders fully on ${label} (${width}x${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openPlay(page);
      const m = await measure(page);
      assertWithinViewport(m, label);
      // Below the desktop breakpoint the shell is full-bleed.
      expect(m.shell.w, `${label}: shell should fill the phone width`).toBeGreaterThan(width - 2);
    });
  }

  test('(b) safe-area insets are declared for the notch and home indicator', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.goto('/index.html#/leaderboard');
    await page.locator('.lb-list').waitFor({ state: 'visible' });

    // viewport-fit=cover is the precondition: without it iOS never reports a
    // non-zero inset and every env() below silently resolves to 0.
    const viewportMeta = await page.getAttribute('meta[name="viewport"]', 'content');
    expect(viewportMeta, 'viewport meta').toContain('viewport-fit=cover');
    expect(viewportMeta, 'viewport meta').toContain('width=device-width');

    /* Read the shipped stylesheet SOURCE rather than the CSSOM. Chromium drops
       env() from the serialized cssText (verified: zero rules report it), and
       it reports every inset as 0 because there is no notch to emulate — so
       neither cssText nor a computed value can tell "declared" from "absent".
       The source can, and "did a refactor drop the inset handling" is exactly
       what this check is for. */
    const css = await page.evaluate(async () => {
      const hrefs = Array.from(
        document.querySelectorAll(/** @type {'link'} */ ('link[rel="stylesheet"]')),
      )
        .map((l) => l.href)
        .filter((h) => h.startsWith(location.origin));
      const texts = await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.text())));
      return texts.join('\n');
    });

    expect(css, 'top inset (notch)').toMatch(/env\(safe-area-inset-top/);
    expect(css, 'bottom inset (home indicator)').toMatch(/env\(safe-area-inset-bottom/);

    // The tab bar is the element that would sit under the home indicator, so
    // its own rule must carry the bottom inset — not just some other rule.
    const tabbarRule = css.match(/\.tabbar\s*\{[^}]*\}/);
    expect(tabbarRule, '.tabbar rule found').not.toBeNull();
    expect(tabbarRule[0], '.tabbar reserves the home-indicator inset').toContain(
      'env(safe-area-inset-bottom',
    );

    // Nothing may sit under the tab bar.
    const overlap = await page.evaluate(() => {
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      return bar.bottom <= window.innerHeight + 1;
    });
    expect(overlap, 'tab bar sits within the viewport').toBe(true);
  });
});

/* ---- (c) no raw null/undefined/NaN --------------------------------- */
test.describe('(c) leaderboard renders no raw empty values', () => {
  const BAD = /\b(null|undefined|NaN)\b/;

  /** Every visible text node on the screen, concatenated. */
  const visibleText = (page) =>
    page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (el.closest('.sr-only')) continue;
        const text = n.textContent.trim();
        if (text) out.push(text);
      }
      return out.join(' | ');
    });

  test('(c) with a normal profile', async ({ page }) => {
    await openLeaderboard(page);
    const text = await visibleText(page);
    expect(text, 'visible text').not.toMatch(BAD);
  });

  test('(c) with a guest (no profile, no rank)', async ({ page }) => {
    // No seed at all: there is no YOU row, so the header's rank must not print.
    await page.addInitScript((k) => localStorage.setItem(k, '1'), COACH_KEY);
    await page.goto('/index.html#/leaderboard');
    await page.locator('.lb-list').waitFor({ state: 'visible' });
    const text = await visibleText(page);
    expect(text, 'visible text').not.toMatch(BAD);
    expect(text, 'no rank claimed without a row').not.toContain('You: #');
  });

  test('(c) with a corrupted stored profile', async ({ page }) => {
    // A stored record with a null name and a null score — the shape that made
    // the board print the literal value.
    await page.addInitScript(
      ([coachKey]) => {
        localStorage.setItem(coachKey, '1');
        localStorage.setItem(
          'mcslice.v1',
          JSON.stringify({
            profile: { id: 'p_bad', name: null, isGuest: false },
            progress: { rewardPoints: 0, bestScore: null, lastScore: 0, gamesPlayed: 0 },
            settings: { soundEnabled: false, reducedMotion: true },
          }),
        );
      },
      [COACH_KEY],
    );
    await page.goto('/index.html#/leaderboard');
    await page.locator('.lb-list').waitFor({ state: 'visible' });
    const text = await visibleText(page);
    expect(text, 'visible text').not.toMatch(BAD);
  });
});

/* ---- (d) real first names only -------------------------------------- */
test.describe('(d) leaderboard names', () => {
  test('(d) seeded rows use approved first names and no gamertags', async ({ page }) => {
    await openLeaderboard(page);

    const names = await page
      .locator('.lb-row:not(.lb-row--you) .lb-row__name span')
      .allTextContents();

    expect(names.length, 'seeded rows rendered').toBe(APPROVED.length);
    for (const name of names.map((n) => n.trim())) {
      expect(APPROVED, `"${name}" is not an approved first name`).toContain(name);
      expect(name, `"${name}" looks like a gamertag`).not.toMatch(GAMERTAG);
    }
  });

  test('(d) no food-pun gamertag survives anywhere on the screen', async ({ page }) => {
    await openLeaderboard(page);
    const body = await page.locator('body').innerText();
    for (const pun of [
      'McSliceKing',
      'FryFanatic',
      'BigMacStacker',
      'SaltySlicer',
      'NuggetNinja',
    ]) {
      expect(body, `retired gamertag "${pun}" still rendered`).not.toContain(pun);
    }
  });
});

/* ---- (e) routing ----------------------------------------------------- */
test.describe('(e) leaderboard route', () => {
  test('(e) /leaderboard loads the standings, not the rewards catalog', async ({ page }) => {
    await openLeaderboard(page);

    // Standings markers present.
    await expect(page.locator('.lb-list')).toBeVisible();
    await expect(page.locator('.season')).toBeVisible();
    await expect(page.locator('.lb-row').first()).toBeVisible();

    // Rewards catalog markers absent.
    await expect(page.locator('.reward-grid')).toHaveCount(0);
    await expect(page.locator('.reward__flag')).toHaveCount(0);

    // And the rewards route still resolves to its own screen, so this is a
    // routing assertion rather than "the rewards page happens to be empty".
    await page.goto('/index.html#/rewards');
    await expect(page.locator('.reward-grid')).toBeVisible();
    await expect(page.locator('.lb-list')).toHaveCount(0);
  });

  test('(e) the ranks tab navigates to the standings', async ({ page }) => {
    await seed(page);
    await page.goto('/index.html#/');
    await page.locator('.tabbar__item[aria-current="page"]').first().waitFor();
    await page.locator('.tabbar__item').nth(3).click();
    await expect(page.locator('.lb-list')).toBeVisible();
    expect(page.url()).toContain('#/leaderboard');
  });
});

/* ---- (f) drift against the Stitch reference -------------------------- */
test.describe('(f) Stitch reference fidelity', () => {
  /* A pixel diff against the Stitch export is not a meaningful signal: the
     reference is a Tailwind CDN page using Material Symbols and remote avatar
     images, none of which the app ships. What IS meaningful is whether the
     live screen still exhibits the reference's structural decisions. Each
     signal below is read out of the reference file itself, so this drifts
     when the reference drifts rather than encoding a snapshot of my reading. */
  const referenceHtml = readFileSync(
    fileURLToPath(new URL('../../stitch-export/screens/leaderboard/source.html', import.meta.url)),
    'utf8',
  );

  test('(f) leaderboard keeps the reference layout decisions', async ({ page }) => {
    // Signals the reference asserts about itself.
    expect(referenceHtml, 'reference has a season countdown').toMatch(/Season Ends In/i);
    expect(referenceHtml, 'reference has a month-end reset pill').toMatch(/MONTH-END RESET/i);
    expect(referenceHtml, 'reference marks the player row').toMatch(/>\s*YOU\s*</);
    expect(referenceHtml, 'reference uses per-row cards').toMatch(/rounded-xl/);

    await openLeaderboard(page);

    // Season card, above the list, carrying the countdown and the reset pill.
    const season = page.locator('.season');
    await expect(season).toBeVisible();
    await expect(season).toContainText(/season ends in/i);
    await expect(season).toContainText(/month-end reset/i);
    await expect(season.locator('svg')).toHaveCount(2); // sunburst + clock

    const seasonBox = await season.boundingBox();
    const listBox = await page.locator('.lb-list').boundingBox();
    expect(seasonBox.y, 'season card sits above the standings').toBeLessThan(listBox.y);

    // Rows are separated cards, not rows in one panel.
    const rowGap = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.lb-row'));
      const a = rows[0].getBoundingClientRect();
      const b = rows[1].getBoundingClientRect();
      return { gap: b.top - a.bottom, radius: getComputedStyle(rows[0]).borderRadius };
    });
    expect(rowGap.gap, 'rows are spaced as cards').toBeGreaterThan(4);
    expect(rowGap.radius, 'rows are rounded cards').not.toBe('0px');

    // Podium carries an icon; the field below carries a number.
    await expect(page.locator('.lb-row').nth(0).locator('.lb-row__medal')).toBeVisible();
    await expect(page.locator('.lb-row').nth(1).locator('.lb-row__medal')).toBeVisible();
    await expect(page.locator('.lb-row').nth(2).locator('.lb-row__medal')).toBeVisible();
    await expect(page.locator('.lb-row').nth(4).locator('.lb-row__medal')).toHaveCount(0);

    // Tier copy and the PTS unit from the reference.
    await expect(page.locator('.lb-row').first()).toContainText(/ultimate master/i);
    await expect(page.locator('.lb-row__unit').first()).toHaveText('PTS');

    // The player's row is flagged and lifted onto the gold surface.
    const you = page.locator('.lb-row--you');
    await expect(you).toBeVisible();
    await expect(you.locator('.lb-row__flag')).toHaveText('YOU');
  });

  test('(f) no emoji survives in the standings or the tab bar', async ({ page }) => {
    await openLeaderboard(page);
    // Pictographic emoji, excluding ordinary text and the ▶ play glyph on the
    // CTA button, which is typographic rather than an emoji presentation.
    const emoji = /\p{Extended_Pictographic}/u;

    const listText = await page.locator('.lb-list').innerText();
    expect(listText, 'standings still contain emoji').not.toMatch(emoji);

    const tabText = await page.locator('.tabbar').innerText();
    expect(tabText, 'tab bar still contains emoji').not.toMatch(emoji);

    // The icons that replaced them are real SVG.
    expect(await page.locator('.tabbar svg').count(), 'tab bar icons are SVG').toBe(4);
    expect(await page.locator('.lb-row__medal').count(), 'podium icons are SVG').toBe(3);
  });

  test('(f) no emoji survives on any player-facing screen', async ({ page }) => {
    await seed(page);
    /* `\p{Extended_Pictographic}` also matches ® and ™, which are required
       brand copy ("Big Mac®"), not emoji — strip them before testing rather
       than loosening the pattern and letting a real emoji back through. */
    const TRADEMARK = /[®™℗]/g;
    const emoji = /\p{Extended_Pictographic}/u;

    for (const [name, hash] of [
      ['welcome', '#/'],
      ['rewards', '#/rewards'],
      ['wallet', '#/wallet'],
      ['leaderboard', '#/leaderboard'],
    ]) {
      await page.goto(`/index.html${hash}`);
      await page.waitForTimeout(500);
      const text = (await page.locator('body').innerText()).replace(TRADEMARK, '');
      expect(text, `${name} still renders emoji`).not.toMatch(emoji);
      // And the icons that replaced them actually rendered.
      expect(await page.locator('.tabbar svg').count(), `${name} tab bar icons`).toBe(4);
    }
  });

  test('(f) the sound toggle swaps its icon instead of erasing it', async ({ page }) => {
    // `span.textContent = '🔊'` would have deleted the SVG child; setIcon()
    // replaces it. Assert an SVG survives the toggle in both directions.
    await seed(page);
    await page.goto('/index.html#/');
    const glyph = page.locator('.welcome__bar .icon-btn span').first();
    await expect(glyph.locator('svg')).toHaveCount(1);
    await page.locator('.welcome__bar .icon-btn').first().click();
    await expect(glyph.locator('svg')).toHaveCount(1);
    await page.locator('.welcome__bar .icon-btn').first().click();
    await expect(glyph.locator('svg')).toHaveCount(1);
  });

  test('(g) each screen has exactly one attention CTA', async ({ page }) => {
    /* "One unmistakable focal point per screen" is the rule the whole polish
       pass rests on, and it is the one that silently rots — every future screen
       author wants THEIR button to glow. Pin it. */
    await seed(page);
    for (const [name, hash] of [
      ['welcome', '#/'],
      ['rewards', '#/rewards'],
      ['wallet', '#/wallet'],
      ['leaderboard', '#/leaderboard'],
    ]) {
      await page.goto(`/index.html${hash}`);
      await page.waitForTimeout(400);
      const glowing = await page.locator('.btn--glow:visible').count();
      expect(glowing, `${name} should have at most one attention CTA`).toBeLessThanOrEqual(1);
    }
    // Welcome's IS the play CTA, and it must be the biggest button there.
    await page.goto('/index.html#/');
    await page.waitForTimeout(300);
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.btn')).map((b) => ({
        glow: b.classList.contains('btn--glow'),
        area: b.getBoundingClientRect().width * b.getBoundingClientRect().height,
      })),
    );
    const cta = sizes.find((b) => b.glow);
    expect(cta, 'welcome has a glowing CTA').toBeTruthy();
    expect(
      Math.max(...sizes.filter((b) => !b.glow).map((b) => b.area)),
      'the CTA is the largest button on welcome',
    ).toBeLessThan(cta.area);
  });

  test('(g) Send Code is inert until the number is valid', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '1'), COACH_KEY);
    await page.goto('/index.html#/sign-in');
    const send = page.locator('[data-act="send-code"]');
    await expect(send).toBeDisabled();

    await page.locator('#phone').fill('123'); // too short
    await expect(send).toBeDisabled();

    await page.locator('#phone').fill('1005551234');
    await expect(send).toBeEnabled();
    await expect(send).toHaveClass(/btn--glow/);

    // And back again — the state is derived, not one-way.
    await page.locator('#phone').fill('12');
    await expect(send).toBeDisabled();
    await expect(send).not.toHaveClass(/btn--glow/);
  });

  test('(g) locked and unlocked speak the same language everywhere', async ({ page }) => {
    await seed(page);
    await page.goto('/index.html#/rewards');
    await page.locator('.reward').first().waitFor();

    // Locked tiles are disabled and carry a padlock; owned tiles never do.
    const locked = page.locator('.reward--locked');
    const lockedCount = await locked.count();
    expect(lockedCount, 'seeded balance should leave some tiles locked').toBeGreaterThan(0);
    for (let i = 0; i < lockedCount; i++) {
      await expect(locked.nth(i)).toBeDisabled();
      expect(await locked.nth(i).locator('.reward__flag svg').count()).toBe(1);
    }

    // Exactly one tile is the active focal point, and it is affordable.
    await expect(page.locator('.reward--active')).toHaveCount(1);
    await expect(page.locator('.reward--active')).toBeEnabled();
    await expect(page.locator('.reward--active .reward__ribbon')).toBeVisible();
  });

  test('(g) the points balance outweighs everything else on Rewards', async ({ page }) => {
    await seed(page);
    await page.goto('/index.html#/rewards');
    await page.locator('.points-head__value').waitFor();
    const px = (loc) =>
      loc.evaluate((n) => parseFloat(getComputedStyle(n).fontSize)).catch(() => 0);

    const balance = await px(page.locator('.points-head__value'));
    const tileName = await px(page.locator('.reward__name').first());
    const rank = await px(page.locator('.rank-chip'));
    expect(balance, 'balance vs tile name').toBeGreaterThan(tileName);
    expect(balance, 'balance vs rank chip').toBeGreaterThan(rank);
  });

  test('(g) the player row is the most emphasised row on the board', async ({ page }) => {
    await openLeaderboard(page);
    const weights = await page.evaluate(() => {
      const read = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const s = getComputedStyle(n);
        return { shadow: s.boxShadow, border: parseFloat(s.borderTopWidth) };
      };
      return { you: read('.lb-row--you'), first: read('.lb-list .lb-row') };
    });
    expect(weights.you, 'a YOU row is present').toBeTruthy();
    // The gold glow is the strongest treatment in the list and only YOU has it.
    expect(weights.you.shadow, 'YOU row carries the attention glow').toContain('255, 199, 44');
    expect(weights.you.border, 'YOU row has the heaviest border').toBeGreaterThanOrEqual(
      weights.first.border,
    );
  });

  test('(f) home and leaderboard capture cleanly for review', async ({ page }, testInfo) => {
    // Artifacts for human review of drift, attached to the report rather than
    // asserted: a committed pixel baseline would fail on first run and on any
    // font-rendering difference between machines, which is noise, not drift.
    await seed(page);
    for (const [name, hash] of [
      ['home', '#/'],
      ['leaderboard', '#/leaderboard'],
    ]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/index.html${hash}`);
      await page.waitForTimeout(400);
      await testInfo.attach(`${name}-390x844`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      // A screen that rendered nothing is drift worth failing on.
      const painted = await page.evaluate(() => document.querySelector('#route').children.length);
      expect(painted, `${name} rendered no content`).toBeGreaterThan(0);
    }
  });
});
