/* ============================================================
   Spawn wave planning.

   Pure: takes a difficulty value and an rng, returns a description of
   what to throw. It knows nothing about canvases, sprites or the DOM,
   which is what makes the fairness guarantee below actually testable.

   THE FAIRNESS GUARANTEE
   Every hazard in a wave is separated from every food in that wave by at
   least `bombClearanceFrac` of the field width, and a wave never contains
   more than `maxBombsPerWave` hazards. Together these mean a wave can
   always be cleared without slicing a hazard — the player is never asked
   to eat a life they had no way to avoid. The previous engine rolled each
   spawn independently with no positional constraint, so genuinely
   impossible waves were not merely possible but routine at high
   difficulty.
   ============================================================ */
import { lerp, range } from './rng.js';
import { corridorGap } from './collision.js';

/** @typedef {import('./rng.js').Rng} Rng */

/**
 * @typedef {object} Spawn
 * @property {'food'|'bomb'|'special'} kind
 * @property {number} startXFrac  launch x, fraction of field width
 * @property {number} targetXFrac landing x, fraction of field width
 * @property {number} apexFrac    peak height, fraction of field height
 * @property {boolean} golden     bonus-value food (ignored for non-food)
 * @property {'frenzy'|'freeze'|null} special
 */

/** Resolve the tuning block, filling defaults so callers can pass partials. */
function withDefaults(t) {
  return {
    easyInterval: 1.05,
    hardInterval: 0.5,
    easyCount: [1, 2],
    hardCount: [2, 4],
    bombChanceEasy: 0.05,
    bombChanceHard: 0.16,
    maxBombsPerWave: 1,
    bombClearanceFrac: 0.18,
    maxLateralFrac: 0.2,
    marginFrac: 0.1,
    // Set by the engine from the visible viewport; overrides marginFrac.
    bounds: null,
    apexMin: 0.58,
    apexMax: 0.74,
    goldenChance: 0.05,
    specialChance: 0.05,
    frenzyIntervalMultiplier: 0.32,
    frenzyExtraCount: 2,
    ...t,
  };
}

/**
 * A corridor is the x-interval an item sweeps while airborne.
 *
 * `bounds` (when supplied) is the range actually VISIBLE on this viewport,
 * already inset by the item radius — see src/game/field.js. It overrides the
 * flat `marginFrac`, which knows nothing about the cover-scale crop and let
 * items launch into the strips of the virtual field that are off screen.
 */
function makeCorridor(rng, tuning) {
  const { marginFrac, maxLateralFrac, bounds } = tuning;
  const lo = bounds ? bounds.minFrac : marginFrac;
  const hi = bounds ? bounds.maxFrac : 1 - marginFrac;
  const startXFrac = range(rng, lo, hi);
  const drift = range(rng, -maxLateralFrac, maxLateralFrac);
  // Clamp the landing point inside the margins rather than letting items
  // sail off-field, which is what the old random-vx spread did.
  const targetXFrac = Math.min(hi, Math.max(lo, startXFrac + drift));
  return { startXFrac, targetXFrac };
}

const clearOf = (c, others, clearance) =>
  others.every(
    (o) => corridorGap(c.startXFrac, c.targetXFrac, o.startXFrac, o.targetXFrac) >= clearance,
  );

/**
 * Find a narrow corridor that clears every hazard, by scanning candidate
 * centres. Deterministic fallback for when rejection sampling fails, so a
 * crowded wave degrades to "fewer items" rather than "unfair items".
 * @returns {{startXFrac:number,targetXFrac:number}|null}
 */
function findClearCorridor(bombs, tuning) {
  const { marginFrac, bombClearanceFrac, bounds } = tuning;
  const lo = bounds ? bounds.minFrac : marginFrac;
  const hi = bounds ? bounds.maxFrac : 1 - marginFrac;
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const c = lo + ((hi - lo) * i) / steps;
    const candidate = { startXFrac: c, targetXFrac: c }; // vertical toss, narrowest possible
    if (clearOf(candidate, bombs, bombClearanceFrac)) return candidate;
  }
  return null;
}

/**
 * Plan one spawn wave.
 * @param {object} o
 * @param {number} o.difficulty 0..1 ramp position
 * @param {Rng} o.rng
 * @param {boolean} [o.frenzy] frenzy power-up active
 * @param {object} [o.tuning] overrides for the defaults above
 * @returns {{intervalSec:number, spawns:Spawn[]}}
 */
export function planWave({ difficulty, rng, frenzy = false, tuning = {} }) {
  const t = withDefaults(tuning);
  const d = Math.min(1, Math.max(0, difficulty));

  const intervalSec =
    lerp(t.easyInterval, t.hardInterval, d) * (frenzy ? t.frenzyIntervalMultiplier : 1);

  const minCount = lerp(t.easyCount[0], t.hardCount[0], d);
  const maxCount = lerp(t.easyCount[1], t.hardCount[1], d);
  let count = Math.round(lerp(minCount, maxCount, rng()));
  if (frenzy) count += t.frenzyExtraCount;
  count = Math.max(1, count);

  const apex = () => range(rng, t.apexMin, t.apexMax);

  /** @type {Spawn[]} */
  const spawns = [];
  /** @type {{startXFrac:number,targetXFrac:number}[]} */
  const bombs = [];

  // Hazards are placed first so foods can be routed around them. Frenzy is a
  // reward, so it never carries hazards — same rule as the original engine.
  if (!frenzy) {
    const bombChance = lerp(t.bombChanceEasy, t.bombChanceHard, d);
    let bombsLeft = t.maxBombsPerWave;
    for (let i = 0; i < count && bombsLeft > 0; i++) {
      if (rng() < bombChance) {
        const c = makeCorridor(rng, t);
        bombs.push(c);
        spawns.push({ kind: 'bomb', ...c, apexFrac: apex(), golden: false, special: null });
        bombsLeft--;
      }
    }
  }

  const foodSlots = count - bombs.length;
  for (let i = 0; i < foodSlots; i++) {
    let c = null;
    for (let attempt = 0; attempt < 12 && !c; attempt++) {
      const candidate = makeCorridor(rng, t);
      if (clearOf(candidate, bombs, t.bombClearanceFrac)) c = candidate;
    }
    // Rejection sampling failed — fall back to a provably clear corridor, or
    // emit nothing rather than an undodgeable pairing.
    if (!c) c = findClearCorridor(bombs, t);
    if (!c) break;
    spawns.push({
      kind: 'food',
      ...c,
      apexFrac: apex(),
      golden: rng() < t.goldenChance,
      special: null,
    });
  }

  // Power-up pickups ride along outside the hazard/food budget.
  if (!frenzy && rng() < t.specialChance) {
    const special = rng() < 0.5 ? 'frenzy' : 'freeze';
    const c = bombs.length ? findClearCorridor(bombs, t) : makeCorridor(rng, t);
    if (c) spawns.push({ kind: 'special', ...c, apexFrac: apex(), golden: false, special });
  }

  return { intervalSec, spawns };
}

/**
 * Difficulty at a given point in the round.
 *
 * Normalised against ROUND duration, not a separate ramp constant. The old
 * engine ramped over a fixed 50s inside a 30s round, so the curve only ever
 * reached ~60% of its range and the closing seconds — the part that should
 * be tensest — plateaued mid-ramp. Tying the ramp to the round guarantees
 * the curve completes exactly as the clock runs out, at any round length.
 *
 * `rampFrac` < 1 lets difficulty top out slightly before the end so the
 * final seconds sit at full intensity rather than still climbing.
 */
export function difficultyAt(elapsedSec, roundSec, rampFrac = 0.85) {
  if (roundSec <= 0) return 1;
  const ramp = Math.max(0.05, rampFrac) * roundSec;
  return Math.min(1, Math.max(0, elapsedSec / ramp));
}
