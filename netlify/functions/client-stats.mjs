/* GET (x-admin-key) ?from=ISO&to=ISO -> the client-facing dashboard
   payload (revenue, orders, code uses, AOV, growth vs. the previous
   equal period, performance series, top rewards, recent orders) in
   one client_dashboard() RPC call. Defaults to the last 30 days. */
import { rpc, ok, bad, isAdmin } from './_lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;

  const to = params.get('to') ? new Date(params.get('to')) : new Date();
  const from = params.get('from')
    ? new Date(params.get('from'))
    : new Date(to.getTime() - 30 * 86400000);
  if (isNaN(from) || isNaN(to) || from >= to) return bad('invalid_range');

  try {
    const data = await rpc('client_dashboard', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    return ok({ data });
  } catch (e) {
    console.error('client-stats:', e.message);
    return bad('server_error', 500);
  }
};
