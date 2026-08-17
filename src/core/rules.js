/* ============================================================
   Live reads of the round rules.

   These are FUNCTIONS, not constants, and that is the whole point.

   Pages used to capture `window.CONFIG.ROUND_TIME` in a module-level
   `const`, which is evaluated once when the module is first imported. A
   campaign manifest is applied slightly later (ADR 0012 — deliberately
   fire-and-forget so first paint is not blocked on a fetch), so every UI
   read was frozen to the built-in McDonald's values. The reskin applied to
   the engine and silently never reached the interface: a 45-second
   campaign showed "SURVIVE 30s" and three lives rendered as two.

   Reading through a function defers the lookup to render time, which is
   after any manifest has landed. The fallbacks match `engine/config.js` so
   these stay correct if the engine scripts somehow have not run.

   `window` itself is guarded, not just `CONFIG`: these modules are imported
   by unit tests running in Node, where a bare `window` reference is a
   ReferenceError rather than `undefined`. A rules module that throws
   outside a browser cannot be tested, and it would break server-side
   rendering if that ever arrived.
   ============================================================ */

/** The global config object, or null anywhere `window` does not exist. */
function cfg() {
  return typeof window === 'undefined' ? null : (window.CONFIG ?? null);
}

/** The global brand object, or null outside a browser. */
function brand() {
  return typeof window === 'undefined' ? null : (window.BRAND ?? null);
}

export const roundSeconds = () => cfg()?.ROUND_TIME ?? 30;
export const startLives = () => cfg()?.START_LIVES ?? 2;
export const pointsThreshold = () => cfg()?.WHEEL?.pointsThreshold ?? 4000;
/** The win bar: score needed to win the round and open the wheel. */
export const spinWheelMinScore = () => cfg()?.SPIN_WHEEL_MIN_SCORE ?? 150;
export const wheelEnabled = () => cfg()?.WHEEL?.enabled !== false;
export const prizes = () => cfg()?.WHEEL?.prizes ?? [];
export const gameName = () => brand()?.gameName ?? 'Slice Rush';
export const brandName = () => brand()?.name ?? '';
