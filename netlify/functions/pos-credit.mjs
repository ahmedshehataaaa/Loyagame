/* POST { phone, orderId, amount | points } → idempotent order-points
   credit, keyed to phone. THE only way players earn loyalty points.
   Callers: the Foodics webhook (x-webhook-secret) or staff/admin
   tools (x-admin-key). Unknown phones get a stub player so points
   wait for them when they first open the game. */
import {
  rpc,
  ok,
  bad,
  isPosCaller,
  normalizeLoosePhone,
  getSettings,
  readBody,
} from './_lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  if (!isPosCaller(req)) return bad('unauthorized', 401);
  const body = await readBody(req);
  if (!body) return bad('bad_json');

  const phone = normalizeLoosePhone(body.phone);
  if (!phone) return bad('invalid_phone');

  try {
    let points = body.points;
    if (!Number.isFinite(points)) {
      if (!Number.isFinite(body.amount)) return bad('amount_or_points_required');
      const s = await getSettings();
      points = Math.round(body.amount * (s.points_per_egp ?? 1));
    }
    if (points <= 0) return bad('invalid_points');

    const rows = await rpc('credit_order_points', {
      p_phone: phone,
      p_order_id: body.orderId ?? null,
      p_points: Math.round(points),
      p_source: req.headers.get('x-webhook-secret') ? 'foodics' : 'manual',
      p_note: body.note ?? null,
      p_amount_egp: Number.isFinite(body.amount) ? body.amount : null,
    });
    const r = rows[0];
    return ok({ playerId: r.player_id, newBalance: r.new_balance, duplicate: r.duplicate });
  } catch (e) {
    console.error('pos-credit:', e.message);
    return bad('server_error', 500);
  }
};
