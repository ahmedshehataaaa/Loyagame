/* GET (x-admin-key, X-Tenant) ?from=ISO&to=ISO&page=1&pageSize=25 ->
   paginated redemption feed (every wheel prize won, redeemed or not) +
   the redemption rate for that range, for that tenant only. */
import { rpc, ok, bad, isAdminFor, tenantContext, dbFailure } from '../lib/db.mjs';

export default async (req) => {
  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const params = new URL(req.url).searchParams;
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
  } catch (e) {
    return dbFailure('admin-redemptions', e);
  }
};
