/* GET (x-admin-key, X-Tenant) ?q=search&page=1&pageSize=25 -> paginated,
   searchable player list. GET ?phone=+201... -> single-player
   drill-down instead (used by the Players tab row click). That tenant's
   players only. */
import { rpc, ok, bad, isAdminFor, tenantContext, dbFailure } from '../lib/db.mjs';

export default async (req) => {
  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const params = new URL(req.url).searchParams;
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
  } catch (e) {
    return dbFailure('admin-players', e);
  }
};
