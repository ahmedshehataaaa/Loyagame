/* GET (x-admin-key) ?month=YYYY-MM → the whole dashboard payload in
   one admin_dashboard() RPC call. */
import { rpc, ok, bad, isAdmin } from '../lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;
  try {
    const stats = await rpc('admin_dashboard', {
      p_month: params.get('month') || null,
    });
    return ok({ stats });
  } catch (e) {
    console.error('admin-stats:', e.message);
    return bad('server_error', 500);
  }
};
