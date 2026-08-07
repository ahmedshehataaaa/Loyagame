/* ============================================================
   Random number generation.

   Production uses Math.random. Tests (and a future replay/debug
   mode) need reproducible rounds, so every mechanics function
   takes an injected `rng` rather than calling Math.random itself.
   Seeding is therefore a test affordance that costs production
   nothing and cannot be triggered from the client — there is no
   query param or global that swaps it.
   ============================================================ */

/** @typedef {() => number} Rng A function returning [0, 1). */

/** The production source. */
export const systemRng = () => Math.random();

/**
 * mulberry32 — small, fast, well-distributed enough for gameplay.
 * Identical seed always yields an identical sequence.
 * @param {number} seed
 * @returns {Rng}
 */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** A random float in [min, max). */
export const range = (rng, min, max) => min + (max - min) * rng();

/** A random integer in [min, max] inclusive. */
export const intRange = (rng, min, max) => Math.floor(min + (max - min + 1) * rng());

/** Pick one element of a non-empty array. */
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
