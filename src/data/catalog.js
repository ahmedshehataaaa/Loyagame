/* ============================================================
   Static content: reward catalog, rank tiers, asset manifest,
   and the seeded leaderboard rivals.

   No rewards API exists for this client build, so the catalog is
   local typed data and redemption state lives in the Store.
   ============================================================ */

/** @typedef {{id:string,name:string,desc:string,cost:number,art:string,tier:number}} Reward */

/** Costs mirror the Rewards Catalog screen (500 / 1,000 / 2,500 / 5,000). */
export const REWARDS = /** @type {Reward[]} */ ([
  {
    id: 'free-fries',
    name: 'Free Fries',
    desc: 'Any regular size',
    cost: 500,
    art: 'assets/items/fries.png',
    tier: 1,
  },
  {
    id: 'big-mac',
    name: 'Big Mac',
    desc: 'The signature stack',
    cost: 1000,
    art: 'assets/items/bigmac.png',
    tier: 2,
  },
  {
    id: 'nuggets-6pc',
    name: '6pc Nuggs',
    desc: 'Chicken McNuggets',
    cost: 2500,
    art: 'assets/items/nuggets.png',
    tier: 3,
  },
  {
    id: 'apple-pie',
    name: 'Pie Me',
    desc: 'Baked apple pie',
    cost: 5000,
    art: 'assets/items/applepie.png',
    tier: 4,
  },
  {
    id: 'mcflurry',
    name: 'McFlurry',
    desc: 'Swirled + topped',
    cost: 7500,
    art: 'assets/items/mcflurry.png',
    tier: 5,
  },
  {
    id: 'hash-brown',
    name: 'Hash Brown',
    desc: 'Crispy, golden',
    cost: 300,
    art: 'assets/items/hashbrown.png',
    tier: 1,
  },
]);

/** Rank titles by lifetime reward points, richest last. */
export const TIERS = [
  { min: 0, name: 'Rookie Slicer' },
  { min: 500, name: 'Line Cook' },
  { min: 1500, name: 'Pro Slicer' },
  { min: 2500, name: 'Head Chef' },
  { min: 5000, name: 'Legend' },
];

export function tierFor(points) {
  let cur = TIERS[0],
    next = null;
  for (let i = 0; i < TIERS.length; i++) {
    if (points >= TIERS[i].min) {
      cur = TIERS[i];
      next = TIERS[i + 1] || null;
    }
  }
  return { current: cur, next };
}

/** Seeded rivals so the board reads like a live season.
 *  PROTOTYPE DATA — replace with a ranked endpoint before launch.
 *  The signed-in player's real best score is merged in at render time. */
export const RIVALS = [
  { id: 'r1', name: 'McSliceKing', score: 942000 },
  { id: 'r2', name: 'FryFanatic_88', score: 885200 },
  { id: 'r3', name: 'BigMacStacker', score: 792500 },
  { id: 'r4', name: 'SaltySlicer', score: 710900 },
  { id: 'r5', name: 'NuggetNinja', score: 698000 },
  { id: 'r6', name: 'QuarterPounder', score: 550400 },
  { id: 'r7', name: 'DipSauceDan', score: 431250 },
  { id: 'r8', name: 'ShakeShakeSam', score: 302700 },
];

/** Asset manifest for the /assets reference route. */
export const ASSET_GROUPS = [
  {
    group: 'Gameplay objects',
    note: 'Sliceable items. Point values live in engine/config.js (FOODS).',
    items: [
      { file: 'assets/items/bigmac.png', name: 'Big Mac' },
      { file: 'assets/items/mcflurry.png', name: 'McFlurry' },
      { file: 'assets/items/filetofish.png', name: 'Filet-O-Fish' },
      { file: 'assets/items/applepie.png', name: 'Apple Pie' },
      { file: 'assets/items/fries.png', name: 'World Famous Fries' },
      { file: 'assets/items/hashbrown.png', name: 'Hash Brown' },
      { file: 'assets/items/nuggets.png', name: 'Chicken McNuggets' },
    ],
  },
  {
    group: 'Obstacles',
    note: 'Slicing the hazard costs a life.',
    items: [{ file: 'assets/items/burnt.png', name: 'Burnt Fries (hazard)' }],
  },
  {
    group: 'Brand & characters',
    note: 'AI-generated stand-ins from the Stitch export — replace with licensed assets before any public use.',
    items: [
      { file: 'assets/brand-logo.png', name: 'Arches mark' },
      { file: 'assets/game-logo.png', name: 'McSlice Rush logo' },
      { file: 'assets/avatar.png', name: 'Player avatar' },
    ],
  },
];
