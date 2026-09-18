/* The admin dashboard's five endpoints, as one module.

   They were five functions under api/. Vercel's Hobby plan allows twelve
   functions per deployment and multi-tenancy added three, so these moved
   behind a single api/admin.mjs that dispatches on `section`. The public
   paths are unchanged — vercel.json and netlify.toml rewrite
   /api/admin-stats and friends onto it — so no caller changed.

   Each section receives the request, the tenant context resolved once by
   api/admin.mjs, and the parsed URL. Tenant scoping and admin auth happen
   there, not here.
   ============================================================ */
import {
  sb,
  rpc,
  ok,
  bad,
  normalizeLoosePhone,
  getSettings,
  readBody,
} from './db.mjs';


async function findPlayer(rawPhone, ctx) {
  const phone = normalizeLoosePhone(rawPhone);
  if (!phone) return null;
  const rows = await sb(`/players?phone=eq.${encodeURIComponent(phone)}&limit=1`, {}, ctx);
  return rows[0] || null;
}

async function stats(req, ctx, url) {


    const params = url.searchParams;
    const stats = await rpc('admin_dashboard', { p_month: params.get('month') || null }, ctx);
    return ok({ stats });
}

async function engagement(req, ctx, url) {


    const params = url.searchParams;
    const days = Math.min(90, Math.max(1, Number(params.get('days')) || 14));
    const stats = await rpc('admin_engagement', { p_days: days }, ctx);
    return ok({ days, stats });
}

async function players(req, ctx, url) {


    const params = url.searchParams;
    const phone = params.get('phone');

    if (phone) {
      const detail = await rpc('admin_player_detail', { p_phone: phone }, ctx);
      if (!detail) return bad('player_not_found', 404);
      return ok({ detail });
    }

    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));
    const list = await rpc(
      'admin_players_list',
      {
        p_search: params.get('q') || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      },
      ctx,
    );
    return ok({ page, pageSize, ...list });
}

async function redemptions(req, ctx, url) {


    const params = url.searchParams;
    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));

    const feed = await rpc(
      'admin_redemptions',
      {
        p_from: params.get('from') || null,
        p_to: params.get('to') || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      },
      ctx,
    );
    return ok({ page, pageSize, ...feed });
}

async function actions(req, ctx, _url) {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);



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
}

/** Section name -> handler. api/admin.mjs rejects anything not here. */
export const SECTIONS = { stats, engagement, players, redemptions, actions };
