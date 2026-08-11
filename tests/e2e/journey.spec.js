import { test, expect } from '@playwright/test';
import { revealThroughWheel } from './spin-reveal.js';

/* The player journey and the screens added in Stage 5: campaign entry ->
   how-to-play -> verify -> play -> one merged result -> wallet, plus terms,
   the offline state and Arabic/RTL.

   The brief's test for the journey is that a first-time player can state what
   the game is, what they can win, how they lose and how long a round lasts —
   from the pre-play screens alone. Several of these specs assert exactly that,
   because it is a content requirement that silently rots otherwise. */

const COACH_KEY = 'mcslice.coached.v1';

const skipCoach = (page) => page.addInitScript((k) => localStorage.setItem(k, '1'), COACH_KEY);

/** A registered (not guest) player, so /play is reachable directly. */
const seedPlayer = (page) =>
  page.addInitScript(() => {
    localStorage.setItem('mcslice.identity.v1', JSON.stringify({ cc: '+20', phone: '1001234567' }));
    localStorage.setItem(
      'mcslice.v1',
      JSON.stringify({
        profile: { id: 'p_test', name: 'Player 4567', isGuest: false },
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
  });

test.describe('campaign entry answers the four questions', () => {
  test('welcome states the game, the stake, the loss rule and the prize', async ({ page }) => {
    await page.goto('/index.html#/');
    const body = page.locator('.welcome');

    // What it is + what you win.
    await expect(body).toContainText(/rewards?/i);
    // How long a round is — pulled from config, so this also catches drift.
    const round = await page.evaluate(() => window.CONFIG.ROUND_TIME);
    await expect(body).toContainText(new RegExp(`${round}`));
    // How you lose.
    await expect(body).toContainText(/burnt/i);
    // What can be won, concretely.
    await expect(body).toContainText(/big mac|fries/i);
  });

  test('the off-brand inherited mascot is gone', async ({ page }) => {
    // The welcome hero was the Pasta & Heat rooster-"P" from a different
    // restaurant's build. It must not come back with a copy-paste.
    await page.goto('/index.html#/');
    await expect(page.locator('img[src*="mascot"]')).toHaveCount(0);
    // Replaced by real item sprites, so the hero is on-brand and previews play.
    await expect(page.locator('.hero__item').first()).toBeVisible();
  });

  test('legal is reachable without playing, at every size', async ({ page }) => {
    // Terms is a text LINK, not a button: as a full button row it cost 48px and
    // pushed the CTA below the fold at 320x568. It must still be reachable
    // everywhere, which is what this asserts across the whole viewport matrix.
    await page.goto('/index.html#/');
    const terms = page.getByRole('link', { name: /terms|الشروط/i });
    await expect(terms).toBeVisible();
    await terms.click();
    await expect(page).toHaveURL(/#\/terms$/);
  });
});

test.describe('how-to-play', () => {
  test('shows once on a fresh device, over the play screen', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    // An overlay, not a route — the URL stays on the game.
    await expect(page.locator('.coach')).toBeVisible();
    await expect(page).toHaveURL(/#\/play$/);
  });

  test('teaches the four things a first-timer needs', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    const coach = page.locator('.coach__panel');
    await expect(coach).toContainText(/swipe/i); // what to do
    await expect(coach).toContainText(/burnt/i); // how you lose
    await expect(coach).toContainText(/last the full|survive/i); // how you win
    await expect(coach).toContainText(/prize/i); // what you get
  });

  test('does not show again once dismissed', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/play');
    await page.locator('.coach__panel button').click();
    await expect(page.locator('.coach')).toHaveCount(0);

    await page.goto('/index.html#/play');
    await expect(page.locator('.coach')).toHaveCount(0);
  });

  test('stays reachable from welcome after first run', async ({ page }) => {
    await seedPlayer(page);
    await skipCoach(page);
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: /how to play/i }).click();
    await expect(page.locator('.coach')).toBeVisible();
  });
});

test.describe('one merged result screen', () => {
  test('a loss lands on /result, not a modal on the play screen', async ({ page }) => {
    await seedPlayer(page);
    await skipCoach(page);
    await page.goto('/index.html#/play');
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      window.UI.showTryAgain(1234, 0, null, false);
    });

    await expect(page).toHaveURL(/#\/result$/);
    await expect(page.locator('.result--lost')).toBeVisible();
  });

  test('win and loss share one layout, differing by headline', async ({ page }) => {
    await seedPlayer(page);
    await skipCoach(page);

    // Loss.
    await page.goto('/index.html#/play');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.UI.showTryAgain(1234, 0, null, false));
    await expect(page).toHaveURL(/#\/result$/);
    const lostCard = await page.locator('.victory__card').count();
    const lostTitle = await page.locator('.victory__title').innerText();

    // Win.
    await page.goto('/index.html#/play');
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const r = await window.LoyaltyData.submitRun(5000, 30000, {
        survived: true,
        outcome: 'survived',
      });
      window.UI.showChooser(5000, r);
    });
    // A win reveals through the wheel first (ADR 0016); the merged Result
    // screen is on the far side of it.
    await revealThroughWheel(page);
    await expect(page).toHaveURL(/#\/result$/);
    const wonCard = await page.locator('.victory__card').count();
    const wonTitle = await page.locator('.victory__title').innerText();

    // Same structure...
    expect(wonCard).toBe(lostCard);
    expect(wonCard).toBe(1);
    // ...different headline.
    expect(wonTitle).not.toBe(lostTitle);
  });

  test('/win still resolves for links already in the wild', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/win');
    await expect(page).toHaveURL(/#\/result$/);
  });

  test('reaching /result with no round explains itself', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/result');
    await expect(page.locator('.state__title')).toBeVisible();
    await expect(page.getByRole('button', { name: /play/i }).first()).toBeVisible();
  });
});

test.describe('wallet and terms', () => {
  test('an empty wallet says what would fill it', async ({ page }) => {
    await seedPlayer(page);
    await page.goto('/index.html#/wallet');
    await expect(page.locator('.state__title')).toBeVisible();
    // The points gate is the actual precondition, so it is shown here.
    await expect(page.locator('.points-head')).toContainText(/1,200|١٬٢٠٠/);
  });

  test('the wallet never offers in-app redemption', async ({ page }) => {
    // Redemption is a server transaction performed by staff; a button that
    // looks like it grants the prize would be a lie about who holds authority.
    await seedPlayer(page);
    await page.goto('/index.html#/wallet');
    const btns = page.locator('.wallet button:not([disabled])');
    for (let i = 0; i < (await btns.count()); i++) {
      await expect(btns.nth(i)).not.toHaveText(/^redeem$/i);
    }
  });

  test('terms state the real rules from live config', async ({ page }) => {
    await page.goto('/index.html#/terms');
    const cfg = await page.evaluate(() => ({
      round: window.CONFIG.ROUND_TIME,
      lives: window.CONFIG.START_LIVES,
      threshold: window.CONFIG.WHEEL.pointsThreshold,
    }));
    const terms = page.locator('.terms');
    await expect(terms).toContainText(new RegExp(`${cfg.round}`));
    await expect(terms).toContainText(new RegExp(`${cfg.lives}`));
    // Threshold appears grouped (4,000), so match on the digits either way.
    await expect(terms).toContainText(/4,000|4000|٤٬٠٠٠/);
    // The random-draw disclosure is a compliance requirement, not decoration.
    await expect(terms).toContainText(/random/i);
  });

  test('terms list the actual prize set', async ({ page }) => {
    await page.goto('/index.html#/terms');
    const count = await page.evaluate(() => window.CONFIG.WHEEL.prizes.length);
    await expect(page.locator('.terms__list li')).toHaveCount(count);
  });
});

test.describe('Arabic and RTL', () => {
  test('switching to Arabic flips direction and translates', async ({ page }) => {
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'العربية' }).click();

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    // A known Arabic string, so this cannot pass on an untranslated page.
    await expect(page.locator('.welcome')).toContainText('العب');
  });

  test('Arabic persists across a reload', async ({ page }) => {
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('RTL does not break the layout', async ({ page }) => {
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'العربية' }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the phone field stays left-to-right in Arabic', async ({ page }) => {
    // Numbers and a leading + read LTR regardless of the surrounding script.
    await page.goto('/index.html#/sign-in');
    await page.evaluate(() => localStorage.setItem('mcslice.lang.v1', 'ar'));
    await page.reload();
    await page.goto('/index.html#/sign-in');
    const dir = await page.evaluate(() => {
      const row = document.querySelector('.field__row');
      return row ? getComputedStyle(row).direction : null;
    });
    expect(dir).toBe('ltr');
  });
});

test.describe('app shell states', () => {
  test('a loading state covers the boot gap and then goes away', async ({ page }) => {
    await page.goto('/index.html#/');
    // Removed on the first route paint; if it lingered, the app would look hung.
    await expect(page.locator('#boot')).toHaveCount(0);
    await expect(page.locator('body.is-booted')).toBeVisible();
  });

  test('going offline shows a banner without blocking play', async ({ page, context }) => {
    await seedPlayer(page);
    await skipCoach(page);
    await page.goto('/index.html#/play');
    await context.setOffline(true);
    await page.evaluate(() => dispatchEvent(new Event('offline')));

    await expect(page.locator('.offline-bar.is-visible')).toBeVisible();
    // Play continues: the canvas is still there and no modal has taken over.
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('.modal')).toHaveCount(0);
    await context.setOffline(false);
  });

  test('a broken route shows a recoverable error, not a blank screen', async ({ page }) => {
    await page.goto('/index.html#/');
    // Force a render failure the way a real bug would: break the outlet target
    // the page writes into.
    await page.evaluate(() => {
      const doc = /** @type {any} */ (document);
      const orig = doc.createElement.bind(doc);
      // Deliberate sabotage: the wallet builds a <section>, so this makes its
      // render throw the way a real bug would.
      doc.createElement = (tag) => {
        if (tag === 'section') throw new Error('sabotage');
        return orig(tag);
      };
      location.hash = '#/wallet';
    });
    await expect(page.locator('.state__title')).toBeVisible();
    await expect(page.locator('a.btn')).toBeVisible();
  });

  test('an unknown route falls back to welcome', async ({ page }) => {
    await page.goto('/index.html#/does-not-exist');
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe('vertical fit', () => {
  /* The regression this locks in: the tab bar is rendered into the scrolling
     route pane after a full-height screen, so every screen was one nav-height
     too tall. The bar sat below the fold and the page scrolled vertically to
     reach it — invisible on first paint, and missed by the horizontal-overflow
     checks in portrait-gameplay.spec.js. */

  /* The campaign-entry and result screens must fit without scrolling: a player
     who has just scanned a code should see the whole offer and the CTA at once,
     and a result should not hide its own reward panel below the fold.

     `/wallet` is deliberately NOT here. It is a list of prizes plus a points
     header — scrolling is the correct behaviour for it, and the requirement that
     matters is that the tab bar stays reachable, asserted below. */
  for (const route of ['/', '/result']) {
    test(`${route} fits the viewport without scrolling`, async ({ page }) => {
      await page.goto(`/index.html#${route}`);
      const overflow = await page.evaluate(() => {
        const pane = document.getElementById('route');
        return pane.scrollHeight - pane.clientHeight;
      });
      // A couple of px of slack for sub-pixel rounding.
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }

  /* Long screens are allowed to scroll — a leaderboard is a list. What must
     hold is that the bar stays reachable, which is what `position: sticky`
     buys. `/sign-in` is deliberately excluded: it is a focused form with no
     tab bar at all. */
  for (const route of ['/', '/wallet', '/result', '/leaderboard', '/terms']) {
    test(`${route} keeps the tab bar on screen`, async ({ page }) => {
      await page.goto(`/index.html#${route}`);
      const visible = await page.evaluate(() => {
        const bar = document.querySelector('.tabbar');
        if (!bar) return null;
        const b = bar.getBoundingClientRect();
        return b.top < window.innerHeight && b.bottom > 0;
      });
      expect(visible, `${route} should render a tab bar`).not.toBeNull();
      expect(visible).toBe(true);
    });
  }

  test('sign-in deliberately has no tab bar', async ({ page }) => {
    // A verification step should not offer four ways to leave it.
    await page.goto('/index.html#/sign-in');
    await expect(page.locator('.tabbar')).toHaveCount(0);
  });
});

test.describe('navigation', () => {
  test('the player nav does not expose the dev asset library', async ({ page }) => {
    await page.goto('/index.html#/');
    const labels = await page.locator('.tabbar__item').allInnerTexts();
    expect(labels.join(' ')).not.toMatch(/asset/i);
  });

  test('the wallet is one tap from anywhere via the tab bar', async ({ page }) => {
    await page.goto('/index.html#/');
    await page.locator('.tabbar__item', { hasText: /rewards|جوائزي/i }).click();
    await expect(page).toHaveURL(/#\/wallet$/);
  });
});
