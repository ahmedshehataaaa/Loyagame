/* GET (x-admin-key, X-Tenant) ?days=14 -> plays/day, score distribution,
   peak play hour-of-day, and drop-off (started vs. actually finished),
   for that tenant only. */
import { rpc, ok, bad, isAdminFor, tenantContext, dbFailure } from './_lib/db.mjs';

export default async (req) => {
  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);

    const params = new URL(req.url).searchParams;
    const days = Math.min(90, Math.max(1, Number(params.get('days')) || 14));
    const stats = await rpc('admin_engagement', { p_days: days }, ctx);
    return ok({ days, stats });
  } catch (e) {
    return dbFailure('admin-engagement', e);
  }
};
