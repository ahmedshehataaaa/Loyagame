/* GET (x-admin-key) ?q=search&page=1&pageSize=25 -> paginated,
   searchable player list. GET ?phone=+201... -> single-player
   drill-down instead (used by the Players tab row click). */
import { rpc, ok, bad, isAdmin } from './_lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;
  const phone = params.get('phone');

  try {
    if (phone) {
      const detail = await rpc('admin_player_detail', { p_phone: phone });
      if (!detail) return bad('player_not_found', 404);
      return ok({ detail });
    }

    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));
    const list = await rpc('admin_players_list', {
      p_search: params.get('q') || null,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    });
    return ok({ page, pageSize, ...list });
  } catch (e) {
    console.error('admin-players:', e.message);
    return bad('server_error', 500);
  }
};
