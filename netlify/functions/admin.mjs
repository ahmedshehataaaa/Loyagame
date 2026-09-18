/* The admin dashboard API, for one tenant: ?section=stats | engagement |
   players | redemptions | actions.

   One function for five endpoints (Hobby-plan function budget). The old
   /api/admin-<section> paths still work — vercel.json rewrites them here —
   so admin.html and the brand dashboard were not touched.

   Tenant resolution and admin auth happen once, here: every section runs
   under that tenant's token, so another tenant's rows are simply not found
   (ADR 0018). */
import { bad, isAdminFor, tenantContext, dbFailure } from './_lib/db.mjs';
import { SECTIONS } from './_lib/admin-sections.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const section = url.searchParams.get('section') ?? '';
  const run = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : null;
  if (!run) return bad('unknown_section', 404);

  try {
    const { ctx, error } = await tenantContext(req, { hideMissing: true });
    if (error) return error;
    if (!isAdminFor(req, ctx.tenant)) return bad('unauthorized', 401);
    return await run(req, ctx, url);
  } catch (e) {
    return dbFailure(`admin-${section}`, e);
  }
};
