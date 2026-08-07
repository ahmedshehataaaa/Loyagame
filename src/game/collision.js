/* ============================================================
   Slice detection.

   A swipe is sampled as a series of points, so hit-testing must be
   segment-vs-circle, not point-vs-circle: at 60fps a fast flick moves
   hundreds of pixels between samples and a point test would tunnel
   straight through an item.
   ============================================================ */

/**
 * Shortest distance from point (px, py) to the segment a→b.
 * Exported because the spawn planner reuses it for corridor clearance.
 */
export function distanceToSegment(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  // Projection of the point onto the segment, clamped to the endpoints.
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Does the blade segment a→b cut a circle at (cx, cy) of radius r?
 *
 * `tolerance` scales the hit radius. It is deliberately ≥ 1: the previous
 * engine used 0.85, a 15% *smaller* target than the sprite the player can
 * see, which is what made slicing feel unresponsive. Forgiving hitboxes
 * are standard for touch and cost nothing in fairness because the same
 * tolerance applies to hazards.
 */
export function segmentHitsCircle(ax, ay, bx, by, cx, cy, r, tolerance = 1) {
  return distanceToSegment(ax, ay, bx, by, cx, cy) < r * tolerance;
}

/**
 * Minimum gap between two vertical flight corridors, as |x| distance.
 * Used to prove a hazard is dodgeable — see wave-planner.
 */
export function corridorGap(aStartX, aTargetX, bStartX, bTargetX) {
  // Corridors are the x-interval each item sweeps through during flight.
  const aLo = Math.min(aStartX, aTargetX);
  const aHi = Math.max(aStartX, aTargetX);
  const bLo = Math.min(bStartX, bTargetX);
  const bHi = Math.max(bStartX, bTargetX);
  if (aHi >= bLo && bHi >= aLo) return 0; // overlapping
  return aLo > bHi ? aLo - bHi : bLo - aHi;
}
