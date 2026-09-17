/* POST { phone, orderId, amount | points } → idempotent order-points
   credit, keyed to phone. THE only way players earn loyalty points.
   Callers: the tenant's POS webhook (x-webhook-secret) or staff/admin
   tools (x-admin-key). Unknown phones get a stub player so points
   wait for them when they first open the game.
   TENANCY (ADR 0018): the tenant comes from X-Tenant (or ?tenant= for
   webhook UIs that cannot set headers), and the secret must be THAT
   tenant's. An unknown tenant gets the same 401 as a wrong secret.
   Order ids are unique per tenant, not globally. */
import {
  rpc,
  ok,
  bad,
  isPosCallerFor,
  normalizeLoosePhone,
  getSettings,
  readBody,
  tenantContext,
  dbFailure,
} from './_lib/db.mjs';

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);

  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isPosCallerFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const body = await readBody(req);
    if (!body) return bad('bad_json');

    const phone = normalizeLoosePhone(body.phone);
    if (!phone) return bad('invalid_phone');

    let points = body.points;
    if (!Number.isFinite(points)) {
      if (!Number.isFinite(body.amount)) return bad('amount_or_points_required');
      const s = await getSettings(ctx);
      points = Math.round(body.amount * (s.points_per_egp ?? 1));
    }
    if (points <= 0) return bad('invalid_points');

    const rows = await rpc(
      'credit_order_points',
      {
        p_phone: phone,
        p_order_id: body.orderId ?? null,
        p_points: Math.round(points),
        p_source: req.headers.get('x-webhook-secret') ? 'foodics' : 'manual',
        p_note: body.note ?? null,
        p_amount_egp: Number.isFinite(body.amount) ? body.amount : null,
      },
      ctx,
    );
    const r = rows[0];
    return ok({ playerId: r.player_id, newBalance: r.new_balance, duplicate: r.duplicate });
  } catch (e) {
    return dbFailure('pos-credit', e);
  }
};
