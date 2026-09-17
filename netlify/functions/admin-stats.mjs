/* GET (x-admin-key, X-Tenant) ?month=YYYY-MM → the whole dashboard payload
   in one admin_dashboard() RPC call, for that tenant only. */
import { rpc, ok, bad, isAdminFor, tenantContext, dbFailure } from './_lib/db.mjs';

export default async (req) => {
  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const params = new URL(req.url).searchParams;
    const stats = await rpc('admin_dashboard', { p_month: params.get('month') || null }, ctx);
    return ok({ stats });
  } catch (e) {
    return dbFailure('admin-stats', e);
  }
};
