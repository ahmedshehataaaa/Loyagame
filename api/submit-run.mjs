/* POST { token, score, durationMs, device } → resolves a round.
   The token (from start-run) binds this to a real, server-initiated
   round, so a curl'd fake score with no token is rejected. The SERVER
   decides the wheel result (weighted) — the client only animates to it.
   The wheel is gated on the player's real ORDER-POINTS balance (not the
   score) — a spin needs, and spends, wheel_points_threshold points.
   Returns:
     { won:true,  prize:{key,label}, prizeIndex, wheel:[{key,label}], orderPoints, pointsThreshold }
     { won:false, gap, suspicious, orderPoints, pointsThreshold }
   `wheel` is the authoritative segment order; the client adds glyphs by
   matching each key to CONFIG.WHEEL, so the animation matches the award. */
import { rpc, ok, bad, getSettings, readBody } from '../lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  const body = await readBody(req);
  if (!body) return bad('bad_json');

  const { token, score, durationMs, device } = body;
  if (!token) return bad('token_required');
  if (!Number.isFinite(score) || score < 0) return bad('invalid_score');

  try {
    const s = await getSettings();
    const prizes = s.wheel_prizes || [];
    const pointsThreshold = s.wheel_points_threshold ?? 4000;

    /* SURVIVAL IS RE-DERIVED HERE, NOT TAKEN FROM THE CLIENT.
       Winning a round means lasting the full duration (ADR 0004), and only a
       won round may be paid out. The request carries a `survived` flag, but it
       is a claim from a browser and is deliberately ignored: a round that ends
       early ended because the player lost their lives, so the ROUND DURATION
       the client reports — already bounded below by `min_run_ms` and cross-
       checked against the server's own token age inside resolve_run — is the
       evidence. Anyone forging a long duration to fake survival has to survive
       `min_run_ms` of real wall-clock time against a token the server
       timestamped, which is the same barrier that protects the score. */
    const roundSec = Number(s.round_time_sec ?? 30);
    const requiredMs = roundSec * 1000 * Number(s.survival_tolerance ?? 0.95);
    const reportedMs = Math.round(durationMs || 0);
    const survived = reportedMs >= requiredMs;

    const rows = await rpc('resolve_run', {
      p_token: token,
      p_score: Math.round(score),
      p_duration: reportedMs,
      p_device: device || null,
      p_points_threshold: pointsThreshold,
      p_min_ms: s.min_run_ms ?? 5000,
      p_max_score: s.max_plausible_score ?? 2000000,
      p_prizes: prizes,
      // Requires the resolve_run signature in supabase/schema.sql at or after
      // 2026-08-07. The RPC consumes the token either way (the play is spent)
      // but only draws a prize when this is true.
      p_survived: survived,
    });
    const r = rows[0];
    if (!r || !r.ok) return bad('invalid_token', 409);

    const wheel = prizes.map((p) => ({ key: p.key, label: p.label }));
    if (r.won) {
      const prizeIndex = wheel.findIndex((w) => w.key === r.prize.key);
      return ok({
        won: true,
        prize: { key: r.prize.key, label: r.prize.label },
        prizeIndex: prizeIndex < 0 ? 0 : prizeIndex,
        wheel,
        orderPoints: r.order_points,
        pointsThreshold,
      });
    }
    return ok({
      won: false,
      // `survived: false` is why there is no prize when the points balance was
      // sufficient — the client needs to tell those two denials apart.
      survived,
      gap: r.gap,
      suspicious: r.suspicious,
      wheel,
      orderPoints: r.order_points,
      pointsThreshold,
    });
  } catch (e) {
    console.error('submit-run:', e.message);
    return bad('server_error', 500);
  }
};
