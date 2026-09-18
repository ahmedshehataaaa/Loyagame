/* POST { cc, phone, device } → whether this player may start a round.
   Read-only eligibility (limits enforced by phone OR device). The game
   calls this right after phone login to decide: play, or show the
   waiting page with a countdown.
   Scoped to the tenant named by X-Tenant: a lockout at one brand does
   not follow the player to another (ADR 0018). */
import {
  rpc,
  ok,
  bad,
  normalizePhone,
  getSettings,
  playerByPhone,
  readBody,
  tenantContext,
  dbFailure,
} from '../lib/db.mjs';
import { webHandler } from '../lib/http.mjs';

const handler = async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  const body = await readBody(req);
  if (!body) return bad('bad_json');

  const { cc, phone, device } = body;
  const { ok: valid, e164 } = normalizePhone(cc, phone);
  if (!valid) return bad('invalid_phone');
  if (!device) return bad('device_required');

  try {
    const { ctx, error } = await tenantContext(req, { live: true });
    if (error) return error;

    const s = await getSettings(ctx);
    const rows = await rpc(
      'check_eligibility',
      {
        p_phone: e164,
        p_device: device,
        p_window_hrs: s.play_window_hrs ?? 24,
        p_max_plays: s.max_plays ?? 5,
        p_lockout_hrs: s.win_lockout_hrs ?? 12,
      },
      ctx,
    );
    const r = rows[0];
    // Also surface the player's real order-points balance + the spin
    // threshold so the client can paint its home progress bar without an
    // extra round-trip. A phone that's never ordered has no player row → 0.
    const player = await playerByPhone(e164, ctx);
    return ok({
      phone: e164,
      eligible: r.eligible,
      reason: r.reason, // ok | locked_win | daily_cap
      lockedUntil: r.locked_until,
      nextPlayAt: r.next_play_at,
      playsLeft: r.plays_left,
      maxPlays: s.max_plays ?? 5,
      orderPoints: player ? player.order_points : 0,
      pointsThreshold: s.wheel_points_threshold ?? 4000,
    });
  } catch (e) {
    return dbFailure('session-status', e);
  }
};

export default webHandler(handler);
