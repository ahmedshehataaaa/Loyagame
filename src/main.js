/* ============================================================
   App entry — registers routes and boots the router.
   The engine bridge is imported first so `window.UI` and
   `window.LoyaltyData` exist before engine/game.js touches them.
   ============================================================ */
import './game/index.js';
import './adapters/engine-bridge.js';
import { Router } from './core/router.js';
import { Store } from './core/store.js';

import { WelcomePage } from './pages/welcome.js';
import { SignInPage } from './pages/signin.js';
import { PlayPage } from './pages/play.js';
import { RewardsPage } from './pages/rewards.js';
import { LeaderboardPage } from './pages/leaderboard.js';
import { VictoryPage } from './pages/victory.js';
import { AssetLibraryPage } from './pages/assets.js';

// Honour the OS reduced-motion preference in persisted settings too.
try {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced !== Store.settings().reducedMotion) {
    Store.get().settings.reducedMotion = reduced;
  }
} catch {
  /* matchMedia unavailable — defaults stand */
}

Router.add('/', WelcomePage)
  .add('/sign-in', SignInPage)
  .add('/play', PlayPage)
  .add('/rewards', RewardsPage)
  .add('/leaderboard', LeaderboardPage)
  .add('/win', VictoryPage)
  .add('/assets', AssetLibraryPage)
  .start(document.getElementById('route'), { fallback: '/' });

// Surface unexpected failures instead of dying silently mid-round.
addEventListener('error', (e) => console.error('Uncaught error:', e.message));
addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));
