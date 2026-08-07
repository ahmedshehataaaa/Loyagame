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
   ============================================================ */

export const roundSeconds = () => window.CONFIG?.ROUND_TIME ?? 30;
export const startLives = () => window.CONFIG?.START_LIVES ?? 2;
export const pointsThreshold = () => window.CONFIG?.WHEEL?.pointsThreshold ?? 4000;
export const wheelEnabled = () => window.CONFIG?.WHEEL?.enabled !== false;
export const prizes = () => window.CONFIG?.WHEEL?.prizes ?? [];
export const gameName = () => window.BRAND?.gameName ?? 'Slice Rush';
export const brandName = () => window.BRAND?.name ?? '';
