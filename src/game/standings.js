/* ============================================================
   Standings — pure leaderboard shaping.

   Extracted from pages/leaderboard.js so the null/NaN guards can be proved
   directly in unit tests instead of through a rendered screen. Nothing here
   touches the DOM, Store, or the network.
   ============================================================ */

/* Tier copy from the Stitch reference, which names the podium and then the
   field. Index is rank - 1; anything past the list is unranked. */
export const TIERS = ['Ultimate Master', 'Diamond Rank', 'Platinum Rank', 'Gold Rank'];

/** @param {number} rank */
export function tierFor(rank) {
  return TIERS[rank - 1] || 'Ranked Player';
}

/**
 * Coerce whatever the standings source hands back into something renderable.
 *
 * The board prints `name` and `score` straight into the DOM, so a row missing
 * either — a player who never set a display name, a score column still NULL
 * because the run has not resolved — rendered the literal string "null" (or
 * "NaN" once a bad score reached `toLocaleString`). The seeded RIVALS never
 * trip this, which is exactly why it survived: it only appears against real
 * data. Normalise at the boundary so no renderer downstream has to care.
 *
 * @param {{ id?: unknown, name?: unknown, score?: unknown, you?: unknown }} row
 */
export function normalizeRow(row) {
  const rawName = row?.name;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'Player';
  const score = Number(row?.score);
  return {
    id: typeof row?.id === 'string' || typeof row?.id === 'number' ? String(row.id) : name,
    name,
    // Negative scores are as impossible as NaN here and would sort above real
    // rows once rendered, so they collapse to the same zero floor.
    score: Number.isFinite(score) && score > 0 ? score : 0,
    you: !!row?.you,
  };
}

/**
 * Normalise, sort and rank a set of rows.
 *
 * Ranks are strictly sequential with no duplicates: ties break on name so the
 * order is stable across renders, and every row gets its own number rather
 * than sharing a position (which would leave gaps the medal lookup can't map).
 *
 * @param {unknown} rows
 */
export function rankStandings(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(normalizeRow);
  list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return list.map((r, i) => ({ ...r, rank: i + 1 }));
}
