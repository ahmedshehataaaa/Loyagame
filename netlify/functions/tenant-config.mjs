/* GET ?slug=<slug>                → the tenant's PUBLISHED manifest
   GET ?slug=<slug>&preview=<tok>  → a DRAFT, for the ops dashboard's preview

   What /play/<slug>/ boots from (src/main.js). Public on purpose: a manifest
   is brand copy, sprite URLs and prize labels the game shows anyway. It is
   served only while the tenant is published and trial/active — a paused
   campaign 404s, and the game says so instead of falling back to another
   brand's skin.

   A preview token is signed and short-lived (lib/db.mjs signPreviewToken),
   issued only by api/ops-tenants.mjs, and bound to both the slug and the
   version. The game plays a preview with rewards switched off. */
import {
  rpc,
  bad,
  resolverContext,
  opsContext,
  verifyPreviewToken,
  dbFailure,
  SLUG_RE,
} from './_lib/db.mjs';

const withCache = (status, obj, cache) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });

export default async (req) => {
  if (req.method !== 'GET') return bad('method_not_allowed', 405);
  const params = new URL(req.url).searchParams;
  const slug = params.get('slug') ?? '';
  if (!SLUG_RE.test(slug)) return bad('invalid_tenant');

  try {
    const previewToken = params.get('preview');
    if (previewToken) {
      const versionId = verifyPreviewToken(slug, previewToken);
      if (!versionId) return bad('invalid_preview', 403);
      const manifest = await rpc('ops_version_manifest', { p_version_id: versionId }, opsContext());
      // save_draft pins brand.id to the tenant's slug, so this also proves the
      // version belongs to the slug in the URL.
      if (manifest?.brand?.id !== slug) return bad('invalid_preview', 403);
      return withCache(200, { ok: true, preview: true, manifest }, 'no-store');
    }

    const config = await rpc('tenant_published_config', { p_slug: slug }, resolverContext());
    if (!config) return withCache(404, { ok: false, error: 'not_available' }, 'no-store');
    return withCache(
      200,
      {
        ok: true,
        preview: false,
        tenant: { slug: config.slug, name: config.name, status: config.status },
        manifest: config.manifest,
      },
      // Short: a pause or a new publish should reach players within a minute.
      'public, max-age=30',
    );
  } catch (e) {
    if (e?.dbMessage === 'version_not_found') return bad('invalid_preview', 403);
    return dbFailure('tenant-config', e);
  }
};
