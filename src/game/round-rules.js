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

/** Fallback win bar, used only if a caller supplies no threshold. */
export const DEFAULT_MIN_SCORE = 150;

/**
 * Resolve how a round ended.
 *
 * WIN = reach the score bar AND still have a life when the clock runs out.
 * The two halves are checked together, here, deliberately: splitting them
 * across call sites is how "won" drifted out of sync with the real round state
 * once already (ADR 0004 — which this rule supersedes, since score now does
 * gate the win). Losing to two bombs is unchanged and still beats everything.
 *
 * @param {object} o
 * @param {number} o.livesRemaining
 * @param {number} o.timeLeftSec
 * @param {number} [o.score]     points banked this round
 * @param {number} [o.minScore]  the bar; CONFIG.SPIN_WHEEL_MIN_SCORE in play
 * @returns {Outcome}
 */
export function resolveOutcome({
  livesRemaining,
  timeLeftSec,
  score = 0,
  minScore = DEFAULT_MIN_SCORE,
}) {
  // Losing every life ends the round immediately and always loses, even if
  // the clock happens to hit zero on the same frame — the hazard wins ties.
  if (livesRemaining <= 0) return OUTCOME.ELIMINATED;
  if (timeLeftSec <= 0) {
    /* Outlasting the clock is not by itself an achievement: a player who never
       touched the screen used to reach Spin to Win and a real prize. The bar is
       low on purpose — one slice clears it — so it separates playing from
       standing still without becoming a target to grind for. */
    const banked = Number(score);
    const bar = Number(minScore);
    if (!Number.isFinite(banked)) return OUTCOME.ELIMINATED;
    if (banked < (Number.isFinite(bar) ? bar : DEFAULT_MIN_SCORE)) return OUTCOME.ELIMINATED;
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
