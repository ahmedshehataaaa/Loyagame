/* ============================================================
   Static content: reward catalog, asset manifest, and the seeded
   leaderboard rivals.

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

/* The membership ladder (Rookie Slicer → Line Cook → Pro Slicer → Head Chef →
   Legend) and its tierFor() lookup were removed: they gave the player a RANK
   and a "next tier" to climb, which framed a game as a loyalty scheme they had
   joined. Points and rewards are unaffected — progress is now measured against
   the next reward's own cost, which is a thing the player can actually spend on.
   Note src/game/standings.js exports its own unrelated TIERS: those are
   LEADERBOARD podium labels, and are still in use. */

/** Seeded rivals so the board reads like a live season.
 *  PROTOTYPE DATA — replace with a ranked endpoint before launch.
 *  The signed-in player's real best score is merged in at render time.
 *
 *  Plain first names, deliberately. The board used food-pun gamertags
 *  (McSliceKing, FryFanatic_88, ...) which read as brand-voice copy rather
 *  than as other players — and on a campaign board that mixes seeded rows
 *  with the player's own real row, anything that looks authored undermines
 *  the one row that is genuinely live. A test pins this list. */
export const RIVALS = [
  { id: 'r1', name: 'Ahmed', score: 942000 },
  { id: 'r2', name: 'Meera', score: 885200 },
  { id: 'r3', name: 'Jana', score: 792500 },
  { id: 'r4', name: 'Youssef', score: 710900 },
  { id: 'r5', name: 'Laila', score: 698000 },
  { id: 'r6', name: 'Omar', score: 550400 },
  { id: 'r7', name: 'Nour', score: 431250 },
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
