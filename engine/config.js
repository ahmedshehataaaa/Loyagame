/* ============================================================
   McSlice Rush — Game Config (McDonald's client build)
   All gameplay + loyalty tuning lives here so it's easy to
   balance or swap in real restaurant menu items later.
   ============================================================ */

const CONFIG = {
  // Virtual resolution the game is designed at. Everything is drawn in this
  // coordinate space and scaled to fit the screen.
  //
  // PORTRAIT (ADR 0006). This was 1280×720 landscape, and the engine faked
  // portrait support by rotating the whole #stage 90° in CSS — which left the
  // canvas HUD lying sideways underneath an un-rotated DOM HUD. A phone game
  // played one-handed in portrait should be authored in portrait; the taller
  // field also gives items a longer, more readable arc.
  WIDTH: 720,
  HEIGHT: 1280,

  // Ballistics. Items are launched by TARGET APEX, not by a hand-tuned
  // velocity (see src/game/ballistics.js), so these stay correct if the
  // virtual resolution ever changes again.
  GRAVITY: 1900, // px/s^2 pulling items back down
  LAUNCH: {
    apexMin: 0.58, // fraction of HEIGHT an item rises, minimum
    apexMax: 0.74, // ...and maximum. ~1.8-2.0s hang time at GRAVITY above.
    maxLateralFrac: 0.2, // furthest sideways drift, fraction of WIDTH
    marginFrac: 0.1, // keep launches/landings this far off each edge
  },

  START_LIVES: 2, // Slice Rush spec: lose after 2 bombs
  COMBO_WINDOW: 0.45, // seconds; slices within this window chain a combo
  HIT_TOLERANCE: 1.08, // slice hitbox vs sprite radius; >1 = forgiving on touch

  // ---- Backend API (Netlify Functions + Supabase) ----------------------
  // The client works fully offline when disabled (or unreachable):
  // localStorage mocks + seeded leaderboard, exactly the pre-backend
  // behavior. Single-file demo builds ship with this flipped off.
  API: {
    enabled: true,
    // Vercel serves these from /api. A redirect in netlify.toml maps
    // /api/* -> /.netlify/functions/* so the same path works on both hosts.
    base: '/api',
  },

  // ---- Play-to-win model (July 2026 pivot) ---------------------------
  // Scan-to-play at the cashier. There is NO competition. The wheel is
  // unlocked by the player's real ORDER-POINTS balance (earned only from
  // ordering): reach WHEEL.pointsThreshold points → the round's end spins
  // the prize wheel and SPENDS those points; below it, a "try again" nudge.
  // It's a repeatable earn-and-spend loop. Play frequency is gated by
  // LIMITS so prizes stay affordable. The server is the source of truth
  // for points, limits + wheel results — the values here are the client
  // mirror (and the offline-demo fallback).
  ROUND_TIME: 30, // seconds per timed round — Slice Rush spec

  // Prize wheel — unlocked when order-points reach pointsThreshold. Weights
  // are the odds of each prize (they sum to 100 so each weight reads as a %).
  // Low-value prizes are common, high-value rare. Edit freely to match
  // margins; the SERVER re-reads these weights, so a redeploy applies new odds.
  WHEEL: {
    enabled: true,
    pointsThreshold: 4000, // ORDER-POINTS needed to spin (a spin spends this); server-authoritative, this is the offline mirror
    prizes: [
      { key: 'off5', glyph: '🎟️', label: '5% off your order', weight: 28 },
      { key: 'fries', glyph: '🍟', label: 'Free Fries', weight: 20 },
      { key: 'off10', glyph: '🎟️', label: '10% off your order', weight: 18 },
      { key: 'hashbrown', glyph: '🥔', label: 'Free Hash Brown', weight: 12 },
      { key: 'nuggets', glyph: '🍗', label: 'Free 6pc Nuggets', weight: 9 },
      { key: 'off15', glyph: '🎟️', label: '15% off your order', weight: 6 },
      { key: 'mcflurry', glyph: '🍦', label: 'Free McFlurry®', weight: 4 },
      { key: 'off20', glyph: '🎟️', label: '20% off your order', weight: 2 },
      { key: 'bigmac', glyph: '🍔', label: 'Free Big Mac®', weight: 0.8 },
      { key: 'off25', glyph: '💥', label: '25% off your order', weight: 0.2 },
    ],
  },

  // Play limits (enforced server-side by phone AND device):
  //  • up to maxPlays rounds per rolling windowHrs
  //  • winning a wheel prize locks the player out for winLockoutHrs
  LIMITS: {
    // Play cap removed (July 2026): rounds are unlimited. The reward gate is
    // ORDER POINTS, not plays, so unlimited rounds cost the business nothing —
    // a reward still costs WHEEL.pointsThreshold points, earned only by
    // ordering. UNLIMITED_PLAYS is the sentinel the UI checks to hide the
    // plays-left counter entirely.
    maxPlays: 999999,
    windowHrs: 24,
    winLockoutHrs: 12, // separate limit: cooldown AFTER a win (still active)
  },

  // Difficulty ramp, expressed as a FRACTION of ROUND_TIME rather than an
  // absolute duration (ADR 0007). It used to be `RAMP_TIME: 50` against a 60s
  // round; when the round became 30s the ramp silently stopped completing, so
  // the curve only ever reached ~60% of its range and the closing seconds —
  // the tensest part by design — plateaued mid-ramp. At 0.85 the curve tops
  // out with ~4.5s left, so the finish sits at full intensity.
  RAMP_FRACTION: 0.85,
  spawn: {
    easyInterval: 1.05,
    hardInterval: 0.5,
    easyCount: [1, 2],
    hardCount: [2, 4],
    bombChanceEasy: 0.05,
    bombChanceHard: 0.16,
    // Fairness constraints — see src/game/wave-planner.js. These guarantee no
    // wave can present an undodgeable hazard, which the brief forbids and the
    // old unconstrained per-spawn roll produced routinely at high difficulty.
    maxBombsPerWave: 1,
    bombClearanceFrac: 0.18,
  },

  // ---- Effects budget (ADR 0011) --------------------------------------
  // Hard ceilings on effect volume. The engine previously let particles,
  // popups and sliced halves accumulate without limit for a whole round, so a
  // frenzy wave at high difficulty cost frame time exactly when the game was
  // busiest AND buried the items the player was aiming at. See
  // src/game/fx-budget.js for the eviction policy.
  FX: {
    maxParticles: 220,
    maxPopups: 12,
    maxHalves: 24,
    bladePoints: 16,
    maxShake: 14, // was a raw 26 on every bomb — hard to re-aim through
    heroShake: 5,
    reducedParticleScale: 0.15,
    reducedShakeScale: 0,
    tickFromSec: 5, // countdown urgency starts here
  },

  // ---- Power-ups (special sliceable items) ---------------------------
  POWERUP: {
    goldenChance: 0.05, // chance a normal spawn is a GOLDEN item (big points + bonus)
    goldenMult: 3, // golden items score this multiple
    specialChance: 0.05, // chance a wave includes a frenzy/freeze pickup
    frenzyDuration: 5, // seconds of rapid spawns after slicing ⚡
    freezeDuration: 4, // seconds of slow-motion after slicing ❄️
  },
};

// Brand theming — change these to reskin the game per restaurant.
// Colours are pushed into CSS variables at boot (see main.js applyBrand).
const BRAND = {
  name: "McDonald's",
  tagline: 'Slice the Menu, Climb the Ranks',
  gameName: 'McSlice Rush',
  knife: '🔪',
  // McDonald's palette: Red #DA291C + Golden Yellow #FFC72C, outlined in
  // near-black #27251F (the "arcade juicy" comic look — see the Stitch
  // design system). Red is the ground colour, yellow the action/reward colour.
  colors: {
    primary: '#DA291C', // McDonald's Red — hero ground
    primary2: '#A81A10', // deep red (pressed edges / bevel lips)
    accent: '#FFC72C', // Golden Yellow — CTAs, currency, win states
    accent2: '#C8930A', // deep gold (pressed edge under yellow)
    green: '#3fb84e', // confirm / success
    green2: '#2c8e3e',
    sky1: '#FFF8F6', // off-white / card surface
    sky2: '#C2331F', // mid red
    sky3: '#A81A10', // flat poster red
  },
  ink: '#27251F', // structural outline colour (4px comic stroke)
};

// Special power-up pickups.
const SPECIALS = {
  frenzy: { id: 'frenzy', glyph: '⚡', radius: 50, juice: '#ffe24d' },
  freeze: { id: 'freeze', glyph: '❄️', radius: 50, juice: '#7fd6ff' },
};

// McDonald's menu roster. Each item is a REAL sprite (`img`) drawn on the
// canvas — no emoji glyphs, so every item is visually distinct in flight.
// `juice` is the splatter colour (matched to the real product), `points` the
// base score, `radius` the hit size (bigger items are slightly easier to hit).
//
// Point values mirror the Item Library screen exactly, so the library and the
// live game never disagree. They're deliberately large (150–600): score is a
// pure bragging-rights stat here, and these values put a good round in the
// 100k–900k range that the leaderboard is designed around.
//
// `glyph` is kept only as a fallback if a sprite fails to load.
// Big Mac is the `hero` (signature sparkle burst) — it's the icon of the
// brand, even though the McFlurry scores slightly higher.
const FOODS = [
  {
    id: 'bigmac',
    img: 'assets/items/bigmac.png',
    glyph: '🍔',
    points: 500,
    radius: 56,
    juice: '#d8892f',
    label: 'Big Mac®',
    hero: true,
  },
  {
    id: 'mcflurry',
    img: 'assets/items/mcflurry.png',
    glyph: '🍦',
    points: 600,
    radius: 50,
    juice: '#e8e2d4',
    label: 'McFlurry®',
  },
  {
    id: 'filetofish',
    img: 'assets/items/filetofish.png',
    glyph: '🐟',
    points: 400,
    radius: 52,
    juice: '#f3e2b8',
    label: 'Filet-O-Fish®',
  },
  {
    id: 'applepie',
    img: 'assets/items/applepie.png',
    glyph: '🥧',
    points: 300,
    radius: 48,
    juice: '#e0b060',
    label: 'Apple Pie',
  },
  {
    id: 'fries',
    img: 'assets/items/fries.png',
    glyph: '🍟',
    points: 250,
    radius: 52,
    juice: '#f0b33a',
    label: 'World Famous Fries®',
  },
  {
    id: 'hashbrown',
    img: 'assets/items/hashbrown.png',
    glyph: '🥔',
    points: 200,
    radius: 48,
    juice: '#d9a13f',
    label: 'Hash Brown',
  },
  {
    id: 'nuggets',
    img: 'assets/items/nuggets.png',
    glyph: '🍗',
    points: 150,
    radius: 44,
    juice: '#d99a3f',
    label: 'Chicken McNuggets®',
  },
];

// BURNT FRIES — the hazard. On-brand because the whole promise is hot, fresh
// food; the burnt batch breaks it. Slicing it costs a life. It wears the
// engine's pulsing red danger ring, with a charred splatter.
const BOMB = {
  id: 'burnt',
  img: 'assets/items/burnt.png',
  glyph: '💣',
  radius: 50,
  juice: '#2b1a10',
  label: 'Burnt Fries — avoid!',
};

// DISCOUNT_TIERS (score-tier "% off" codes) was removed 2026-08-07. It had
// been dead since the July 2026 pivot to the order-points prize wheel, and the
// reward model was reconfirmed as the wheel on 2026-08-07 — so it was two
// models out of date while still sitting in the file that reviewers are told is
// the security-sensitive reward surface. Recover from git history (tag
// baseline-2026-08-07) if a discount-tier model is ever revived.

// Expose for ES module consumers (top-level const does not attach to window).
window.CONFIG = CONFIG;
window.FOODS = FOODS;
window.BOMB = BOMB;
window.BRAND = BRAND;
window.SPECIALS = SPECIALS;
