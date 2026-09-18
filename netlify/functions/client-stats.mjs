/* GET (x-admin-key, X-Tenant) ?from=ISO&to=ISO -> the client-facing
   dashboard payload (revenue, orders, code uses, AOV, growth vs. the
   previous equal period, performance series, top rewards, recent orders)
   in one client_dashboard() RPC call, for that tenant only. Defaults to
   the last 30 days. */
import { rpc, ok, bad, isAdminFor, tenantContext, dbFailure } from './_lib/db.mjs';
import { webHandler } from './_lib/http.mjs';

const handler = async (req) => {
  const params = new URL(req.url).searchParams;

  const to = params.get('to') ? new Date(params.get('to')) : new Date();
  const from = params.get('from')
    ? new Date(params.get('from'))
    : new Date(to.getTime() - 30 * 86400000);

  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);
    if (isNaN(from) || isNaN(to) || from >= to) return bad('invalid_range');

    const data = await rpc(
      'client_dashboard',
      { p_from: from.toISOString(), p_to: to.toISOString() },
      ctx,
    );
    return ok({ data });
  } catch (e) {
    return dbFailure('client-stats', e);
  }
};

export default webHandler(handler);
