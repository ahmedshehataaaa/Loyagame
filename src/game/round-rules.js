/* ============================================================
   Round outcome rules.

   Decided 2026-08-07 (ADR 0004): a round is WON by surviving the full
   duration. Score is leaderboard bragging rights only and does not gate
   the win. Previously the engine ended the round identically whether the
   timer expired or the player lost all lives, and "won" was computed in
   the browser as `score >= 15000` — so a player who died to bombs at 28s
   with a high score was told they had won.

   This module decides the OUTCOME (did they survive?). It does not and
   must not decide the REWARD — that is server-only. See
   docs/security/reward-wheel-compliance.md and CLAUDE.md.
   ============================================================ */

/** @typedef {'survived'|'eliminated'} Outcome */

export const OUTCOME = /** @type {const} */ ({
  SURVIVED: 'survived',
  ELIMINATED: 'eliminated',
});

/** A round must be PLAYED, not merely waited out. */
export const MIN_SLICES_TO_WIN = 1;

/**
 * Resolve how a round ended.
 *
 * Both win conditions are checked together, here, deliberately: surviving the
 * clock AND landing at least one slice. Splitting them across two call sites is
 * how "won" drifted out of sync with the real round state once already (ADR
 * 0004).
 *
 * @param {object} o
 * @param {number} o.livesRemaining
 * @param {number} o.timeLeftSec
 * @param {number} [o.itemsSliced]  non-bomb items sliced this round; absent
 *   counts as zero, so a caller that forgets it cannot accidentally win
 * @returns {Outcome}
 */
export function resolveOutcome({ livesRemaining, timeLeftSec, itemsSliced = 0 }) {
  // Losing every life ends the round immediately and always loses, even if
  // the clock happens to hit zero on the same frame — the hazard wins ties.
  if (livesRemaining <= 0) return OUTCOME.ELIMINATED;
  if (timeLeftSec <= 0) {
    /* Idling to the buzzer used to satisfy the win condition on its own, so a
       player who never touched the screen still reached Spin to Win and a real
       prize. Surviving is necessary but no longer sufficient. */
    const sliced = Number(itemsSliced);
    if (!Number.isFinite(sliced) || sliced < MIN_SLICES_TO_WIN) return OUTCOME.ELIMINATED;
    return OUTCOME.SURVIVED;
  }
  // Round ended early with lives intact (quit / teardown): not a survival.
  return OUTCOME.ELIMINATED;
}

/** Did this outcome win the round? */
export const isWin = (outcome) => outcome === OUTCOME.SURVIVED;

/**
 * Apply a hazard hit.
 * @returns {{livesRemaining:number, eliminated:boolean}}
 */
export function applyHazardHit(livesRemaining) {
  const next = Math.max(0, livesRemaining - 1);
  return { livesRemaining: next, eliminated: next <= 0 };
}

/**
 * Is this run's shape plausible for the configured round?
 *
 * A local sanity check only — it mirrors the server's bounds so the client
 * can avoid submitting obvious garbage. The server repeats it and is the
 * only authority; never treat a `true` here as permission to award anything.
 */
export function isPlausibleRun({ durationMs, roundSec, score, maxScorePerSecond = 40000 }) {
  const expected = roundSec * 1000;
  if (!Number.isFinite(durationMs) || durationMs < 0) return false;
  if (durationMs > expected * 1.5 + 5000) return false;
  if (!Number.isFinite(score) || score < 0) return false;
  if (score > (durationMs / 1000) * maxScorePerSecond) return false;
  return true;
}
