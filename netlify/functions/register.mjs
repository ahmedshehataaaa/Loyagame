/* POST { cc, phone, consent } → { ok, playerId, deviceToken, profile }
   Identity is UNVERIFIED by design (user decision July 2026): the
   number is trusted as typed. Re-claiming a phone that already has
   points or games appends a fraud flag for the dashboard instead of
   blocking — review happens at prize payout. */
import { sb, ok, bad, normalizePhone, playerByPhone, readBody } from './_lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  const body = await readBody(req);
  if (!body) return bad('bad_json');

  const { cc, phone, consent } = body;
  if (!consent) return bad('consent_required');
  const { ok: valid, e164 } = normalizePhone(cc, phone);
  if (!valid) return bad('invalid_phone');

  try {
    let player = await playerByPhone(e164);

    if (player) {
      const patch = { consent: true, country_code: cc, last_seen_at: new Date().toISOString() };
      // A phone with real balance being re-claimed is worth a look.
      if (player.order_points > 0 || player.games > 0) {
        patch.flags = [
          ...player.flags,
          {
            type: 'reclaim',
            at: new Date().toISOString(),
            note: 'phone re-registered while holding points/history',
          },
        ];
      }
      const rows = await sb(`/players?id=eq.${player.id}`, {
        method: 'PATCH',
        body: patch,
        headers: { Prefer: 'return=representation' },
      });
      player = rows[0];
    } else {
      const rows = await sb('/players', {
        method: 'POST',
        body: { phone: e164, country_code: cc, consent: true },
        headers: { Prefer: 'return=representation' },
      });
      player = rows[0];
    }

    return ok({
      playerId: player.id,
      deviceToken: player.device_token,
      profile: {
        orderPoints: player.order_points,
        highScore: player.high_score,
        games: player.games,
      },
    });
  } catch (e) {
    console.error('register:', e.message);
    return bad('server_error', 500);
  }
};
