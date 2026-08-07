/* ============================================================
   Effect budgets.

   Two problems this solves, both from the audit:

   1. **Unbounded effect arrays** (finding P7). `particles`, `popups` and
      `halves` grew without any cap for the whole round. A frenzy wave at
      high difficulty could put thousands of particles on screen, which
      costs frame time exactly when the game is busiest — and buries the
      items the player is trying to hit.

   2. **Effects that hide gameplay.** The brief is explicit: controlled
      particles, no visual clutter, nothing that obscures objects. A budget
      is the only way to state that as a rule rather than a hope.

   The policy is "newest wins": when a list is full, the OLDEST entry is
   dropped to make room. Dropping the newest would mean the slice the
   player just made produced no feedback, which is the one effect that must
   never be skipped. Oldest entries are the most faded anyway.
   ============================================================ */

/** Defaults; `CONFIG.FX` overrides these per build. */
export const FX_DEFAULTS = Object.freeze({
  maxParticles: 220,
  maxPopups: 14,
  maxHalves: 24,
  bladePoints: 14,
  // Reduced motion keeps feedback but strips the decorative volume.
  reducedParticleScale: 0.15,
  reducedShakeScale: 0,
});

/**
 * Push into a capped list, dropping the oldest to make room.
 *
 * Mutates and returns the array so call sites read like a normal push. Uses
 * shift() rather than rebuilding: these lists are small and shift on a few
 * hundred elements is far cheaper per frame than allocating a new array.
 *
 * @template T
 * @param {T[]} list
 * @param {T} item
 * @param {number} max
 * @returns {T[]}
 */
export function capPush(list, item, max) {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return list;
  list.push(item);
  while (list.length > limit) list.shift();
  return list;
}

/**
 * How many particles a burst should actually emit.
 *
 * Scales the requested count down as the pool fills, so a burst late in a
 * busy frame degrades gracefully instead of evicting everything that came
 * before it. Under reduced motion the count collapses to a token few — the
 * player still gets confirmation that a hit registered, without the spray.
 *
 * @param {number} requested
 * @param {object} o
 * @param {number} o.inUse    particles currently alive
 * @param {number} o.max      pool ceiling
 * @param {boolean} [o.reduced]
 * @param {number} [o.reducedScale]
 * @returns {number}
 */
export function burstSize(requested, { inUse, max, reduced = false, reducedScale = 0.15 }) {
  const want = Math.max(0, Math.floor(requested));
  if (want === 0) return 0;

  if (reduced) {
    // Always at least one, so "something happened" is never silent visually.
    return Math.min(want, Math.max(1, Math.round(want * reducedScale)));
  }

  const headroom = Math.max(0, max - inUse);
  if (headroom >= want) return want;
  // Past the ceiling, still emit a minimum so the newest hit is legible.
  return Math.max(Math.min(want, 4), headroom);
}

/**
 * Screen-shake magnitude, clamped and motion-aware.
 *
 * The brief allows "light screen shake only where suitable". The engine used
 * a raw 26 on every bomb, which is heavy enough to make the field hard to
 * read at the exact moment the player needs to re-aim. Clamped here so no
 * call site can exceed the ceiling by accident.
 */
export function shakeAmount(requested, { max = 14, reduced = false, reducedScale = 0 } = {}) {
  const want = Math.max(0, requested);
  if (reduced) return want * reducedScale;
  return Math.min(want, max);
}

/**
 * Should the countdown tick this frame?
 *
 * Fires once for each whole second remaining in `fromSec..1`, driven by the
 * second boundary being CROSSED rather than by a per-frame test — the latter
 * would fire 60 times a second at 60fps and once at 1fps.
 *
 * The window is judged on `ceil(timeLeft)` *after* the step, i.e. the second
 * the clock has just entered. Gating on `prevTimeLeft <= fromSec` instead is
 * off by one: at the moment the `fromSec` boundary is crossed, `prev` is by
 * definition still just above it, so the first tick of the window never fired.
 */
export function shouldTick(prevTimeLeft, timeLeft, fromSec = 5) {
  if (timeLeft <= 0 || prevTimeLeft <= 0) return false;
  const entered = Math.ceil(timeLeft);
  if (entered < 1 || entered > fromSec) return false;
  return Math.ceil(prevTimeLeft) !== entered;
}
