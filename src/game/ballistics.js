/* ============================================================
   Projectile maths for tossed items.

   The old engine hardcoded launch velocities tuned by hand for a
   1280×720 landscape field. Those numbers are wrong for any other
   field size: the same upward velocity that arcs beautifully across
   720px of height barely clears a third of a 1280px portrait field.

   So nothing here is a magic number — velocities are DERIVED from
   "how high should this reach, as a fraction of the field" plus
   gravity. Change the field size or gravity and the arcs stay
   correct without retuning.
   ============================================================ */

/**
 * Upward speed (px/s, positive) needed to reach `apex` px above the
 * launch point under constant `gravity`. From v² = 2·g·h.
 * @param {number} gravity px/s²
 * @param {number} apex px
 */
export function launchSpeedForApex(gravity, apex) {
  return Math.sqrt(2 * Math.max(0, gravity) * Math.max(0, apex));
}

/**
 * Seconds an item launched at `speed` spends in the air before returning
 * to its launch height. Symmetric flight: t = 2v/g.
 */
export function hangTime(gravity, speed) {
  if (gravity <= 0) return Infinity;
  return (2 * speed) / gravity;
}

/**
 * Horizontal velocity that carries an item from `startX` to `targetX`
 * over `flightSeconds`.
 *
 * Solving for the landing point instead of picking a random vx is what
 * guarantees items stay on screen — the previous engine picked vx from a
 * random spread and, at portrait width, routinely threw items clean out
 * of the field before the player could reach them.
 */
export function horizontalVelocity(startX, targetX, flightSeconds) {
  if (flightSeconds <= 0) return 0;
  return (targetX - startX) / flightSeconds;
}

/**
 * Full launch solution for one item.
 * @param {object} o
 * @param {number} o.gravity px/s²
 * @param {number} o.fieldHeight px
 * @param {number} o.startX px
 * @param {number} o.targetX px — where it should come back down
 * @param {number} o.apexFrac fraction of fieldHeight to rise
 * @returns {{vx:number, vy:number, apex:number, flightSeconds:number}}
 */
export function solveLaunch({ gravity, fieldHeight, startX, targetX, apexFrac }) {
  const apex = fieldHeight * apexFrac;
  const speed = launchSpeedForApex(gravity, apex);
  const flightSeconds = hangTime(gravity, speed);
  return {
    vx: horizontalVelocity(startX, targetX, flightSeconds),
    vy: -speed, // negative = upward, matching canvas y-down coordinates
    apex,
    flightSeconds,
  };
}
