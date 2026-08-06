/* POST { cc, phone, device } → grants a round. Upserts the player,
   re-checks eligibility atomically, records the run (so the play is
   counted up front — no fishing), and returns a one-time token that
   submit-run must present. If not eligible, returns the lockout reason
   + when they can play again. */
import { rpc, ok, bad, normalizePhone, getSettings, monthKey, readBody } from '../lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  const body = await readBody(req);
  if (!body) return bad('bad_json');

  const { cc, phone, device } = body;
  const { ok: valid, e164 } = normalizePhone(cc, phone);
  if (!valid) return bad('invalid_phone');
  if (!device) return bad('device_required');

  try {
    const s = await getSettings();
    const rows = await rpc('start_play', {
      p_phone: e164, p_cc: cc, p_device: device,
      p_window_hrs: s.play_window_hrs ?? 24,
      p_max_plays: s.max_plays ?? 999999,   // play cap removed; see settings.max_plays
      p_lockout_hrs: s.win_lockout_hrs ?? 12,
      p_month: monthKey(),
    });
    const r = rows[0];
    if (!r.ok) {
      return ok({ granted: false, reason: r.reason, nextPlayAt: r.next_play_at });
    }
    return ok({
      granted: true,
      token: r.token,
      playsLeft: r.plays_left,
    });
  } catch (e) {
    console.error('start-run:', e.message);
    return bad('server_error', 500);
  }
};
