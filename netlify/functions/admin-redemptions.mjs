/* GET (x-admin-key) ?from=ISO&to=ISO&page=1&pageSize=25 -> paginated
   redemption feed (every wheel prize won, redeemed or not) + the
   redemption rate for that range. */
import { rpc, ok, bad, isAdmin } from './_lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));

  try {
    const feed = await rpc('admin_redemptions', {
      p_from: params.get('from') || null,
      p_to: params.get('to') || null,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    });
    return ok({ page, pageSize, ...feed });
  } catch (e) {
    console.error('admin-redemptions:', e.message);
    return bad('server_error', 500);
  }
};
