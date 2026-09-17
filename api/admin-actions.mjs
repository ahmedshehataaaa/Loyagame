/* POST (x-admin-key, X-Tenant) { action, ... } → owner/staff tools:
   credit_points, adjust_points, lookup_player, flag_player,
   clear_flags, redeem_prize. Manual credit is the POS fallback until
   the Foodics webhook is registered.
   Every action runs under the tenant's token, so a phone or win id from
   another tenant is simply not found (ADR 0018). */
import {
  sb,
  rpc,
  ok,
  bad,
  isAdminFor,
  normalizeLoosePhone,
  getSettings,
  readBody,
  tenantContext,
  dbFailure,
} from '../lib/db.mjs';

async function findPlayer(rawPhone, ctx) {
  const phone = normalizeLoosePhone(rawPhone);
  if (!phone) return null;
  const rows = await sb(`/players?phone=eq.${encodeURIComponent(phone)}&limit=1`, {}, ctx);
  return rows[0] || null;
}

export default async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);

  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const body = await readBody(req);
    if (!body?.action) return bad('action_required');

    switch (body.action) {
      case 'credit_points': {
        const phone = normalizeLoosePhone(body.phone);
        if (!phone) return bad('invalid_phone');
        let points = body.points;
        if (!Number.isFinite(points)) {
          if (!Number.isFinite(body.amountEgp)) return bad('amount_or_points_required');
          const s = await getSettings(ctx);
          points = Math.round(body.amountEgp * (s.points_per_egp ?? 1));
        }
        if (points <= 0) return bad('invalid_points');
        const rows = await rpc(
          'credit_order_points',
          {
            p_phone: phone,
            p_order_id: body.orderId ?? null,
            p_points: Math.round(points),
            p_source: 'manual',
            p_note: body.note ?? 'admin credit',
            p_amount_egp: Number.isFinite(body.amountEgp) ? body.amountEgp : null,
          },
          ctx,
        );
        return ok({ result: rows[0] });
      }

      case 'adjust_points': {
        const player = await findPlayer(body.phone, ctx);
        if (!player) return bad('player_not_found', 404);
        if (!Number.isFinite(body.delta) || body.delta === 0) return bad('invalid_delta');
        await sb(
          '/points_ledger',
          {
            method: 'POST',
            body: {
              player_id: player.id,
              delta: Math.round(body.delta),
              reason: 'adjust',
              source: 'manual',
              note: body.note ?? 'admin adjustment',
            },
          },
          ctx,
        );
        const fresh = await sb(`/players?id=eq.${player.id}&select=order_points`, {}, ctx);
        return ok({ newBalance: fresh[0].order_points });
      }

      case 'lookup_player': {
        const player = await findPlayer(body.phone, ctx);
        if (!player) return bad('player_not_found', 404);
        const [ledger, runs] = await Promise.all([
          sb(`/points_ledger?player_id=eq.${player.id}&order=created_at.desc&limit=10`, {}, ctx),
          sb(`/runs?player_id=eq.${player.id}&order=created_at.desc&limit=10`, {}, ctx),
        ]);
        return ok({ player, ledger, runs });
      }

      case 'flag_player': {
        const player = await findPlayer(body.phone, ctx);
        if (!player) return bad('player_not_found', 404);
        const flags = [
          ...player.flags,
          {
            type: body.type || 'review',
            at: new Date().toISOString(),
            note: body.note ?? null,
          },
        ];
        await sb(`/players?id=eq.${player.id}`, { method: 'PATCH', body: { flags } }, ctx);
        return ok({ flags });
      }

      case 'clear_flags': {
        const player = await findPlayer(body.phone, ctx);
        if (!player) return bad('player_not_found', 404);
        await sb(`/players?id=eq.${player.id}`, { method: 'PATCH', body: { flags: [] } }, ctx);
        return ok({});
      }

      case 'redeem_prize': {
        if (!Number.isFinite(body.winId)) return bad('invalid_win_id');
        const rows = await rpc(
          'redeem_wheel_win',
          { p_win_id: body.winId, p_redeemed_by: body.redeemedBy || 'dashboard' },
          ctx,
        );
        const r = rows[0];
        if (!r.ok) return bad(r.error, r.error === 'not_found' ? 404 : 409);
        return ok({ prizeLabel: r.prize_label, redeemedAt: r.redeemed_at });
      }

      default:
        return bad('unknown_action');
    }
  } catch (e) {
    return dbFailure('admin-actions', e);
  }
};
