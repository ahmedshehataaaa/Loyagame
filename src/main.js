/* ============================================================
   App entry — locale, routes, and the app-shell states.

   Order matters. i18n comes first so the very first render is in the right
   language and direction; the engine bridge second so `window.UI` and
   `window.LoyaltyData` exist before engine/game.js is ever ticked; the
   mechanics namespace before that for the same reason.
   ============================================================ */
import './game/index.js';
import { loadCampaign } from './campaign/loader.js';
import { initI18n, t, onLangChange } from './core/i18n.js';
import './adapters/engine-bridge.js';
import { Router, navigate } from './core/router.js';
import { Store } from './core/store.js';

import { WelcomePage } from './pages/welcome.js';
import { SignInPage } from './pages/signin.js';
import { PlayPage } from './pages/play.js';
import { RewardsPage } from './pages/rewards.js';
import { LeaderboardPage } from './pages/leaderboard.js';
import { ResultPage } from './pages/result.js';
import { WalletPage } from './pages/wallet.js';
import { TermsPage } from './pages/terms.js';
import { AssetLibraryPage } from './pages/assets.js';

initI18n();

/* ---- Campaign manifest -------------------------------------------------
   One engine, per-restaurant data (ADR 0012). `?campaign=<id>` selects a
   manifest from campaigns/; with no parameter the built-in McDonald's config in
   engine/config.js stands, so a demo build and an offline first load both keep
   working.

   Deliberately fire-and-forget: the engine already has a complete, valid
   config, so blocking first paint on a network fetch would trade a guaranteed
   delay for an optional cosmetic gain. The manifest overlays brand and content
   when it lands; a rejected one is logged and ignored (fail-closed). */
try {
  const requested = new URLSearchParams(location.search).get('campaign');
  if (requested && /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested)) {
    loadCampaign(`campaigns/${requested}.json`);
  }
} catch {
  /* no URL access — built-in config stands */
}

// Honour the OS reduced-motion preference in persisted settings too.
try {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced !== Store.settings().reducedMotion) {
    Store.get().settings.reducedMotion = reduced;
  }
} catch {
  /* matchMedia unavailable — defaults stand */
}

/* ---- Offline banner ----------------------------------------------------
   A persistent, non-blocking strip rather than a modal: being offline does
   not stop play, it only stops rewards, so it must not interrupt a round.
   The reward path already fails closed on its own (reward-state.js); this
   just explains why. */
function offlineBanner() {
  const bar = document.createElement('div');
  bar.className = 'offline-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');

  const paint = () => {
    const off = navigator.onLine === false;
    bar.textContent = off ? t('common.offline') : '';
    bar.classList.toggle('is-visible', off);
  };

  addEventListener('online', paint);
  addEventListener('offline', paint);
  onLangChange(paint);
  paint();
  document.body.append(bar);
}
offlineBanner();

Router.add('/', WelcomePage)
  .add('/sign-in', SignInPage)
  .add('/play', PlayPage)
  .add('/rewards', RewardsPage)
  .add('/leaderboard', LeaderboardPage)
  .add('/result', ResultPage)
  // `/win` predates the merged result screen (ADR 0010). Kept as a redirect so
  // any deep link, bookmark or QR code already in the wild still lands somewhere
  // sensible instead of bouncing to the welcome screen.
  .add('/win', () => navigate('/result', { replace: true }))
  .add('/wallet', WalletPage)
  .add('/terms', TermsPage)
  // Dev/QA reference, deliberately not in the player navigation.
  .add('/assets', AssetLibraryPage)
  .start(document.getElementById('route'), { fallback: '/' });

/* A language switch re-renders the current route in place: pages read i18n at
   build time, so there is nothing to diff — just paint them again. */
onLangChange(() => Router.repaint());

/* The shell's pre-boot loading state has served its purpose once the first
   route paints. Removing it here (rather than on `load`) means it covers exactly
   the gap it exists for: module evaluation and first render. */
document.addEventListener(
  'route:changed',
  () => {
    document.getElementById('boot')?.remove();
    document.body.classList.add('is-booted');
  },
  { once: true },
);

// Surface unexpected failures instead of dying silently mid-round.
addEventListener('error', (e) => console.error('Uncaught error:', e.message));
addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));
