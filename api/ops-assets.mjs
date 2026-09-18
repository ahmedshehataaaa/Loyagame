/* POST (x-ops-key) { tenantId, kind, contentType } -> a signed upload URL
   for one brand asset, and the public URL it will be served from.

     kind         "logo" | "item" | "hazard"
     contentType  "image/png" | "image/webp" | "image/jpeg"

   The browser PUTs the file straight to Supabase Storage with the returned
   URL, so image bytes never pass through a function.

   THE PATH IS BUILT HERE, never taken from the caller:
     tenant-assets/<tenant id>/<kind>/<random uuid>.<ext>
   so one tenant's upload cannot overwrite or land in another tenant's folder,
   and names cannot be guessed. The bucket's own policies (migration 0006)
   enforce the same folder rule for any other writer.

   This is the one remaining use of SUPABASE_SERVICE_KEY (ADR 0018): signing an
   upload URL is a Storage API call, not a data query. */
import { randomUUID } from 'node:crypto';
import { sb, ok, bad, readBody, isOpsAdmin, opsContext, dbFailure, UUID_RE } from '../lib/db.mjs';
import { webHandler } from '../lib/http.mjs';

const BUCKET = 'tenant-assets';
const KINDS = new Set(['logo', 'item', 'hazard']);
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

const handler = async (req) => {
  if (req.method !== 'POST') return bad('method_not_allowed', 405);
  if (!isOpsAdmin(req)) return bad('unauthorized', 401);

  const body = await readBody(req);
  if (!body) return bad('bad_json');
  if (!UUID_RE.test(body.tenantId ?? '')) return bad('invalid_tenant');
  if (!KINDS.has(body.kind)) return bad('invalid_kind');
  const ext = EXT[body.contentType];
  if (!ext) return bad('unsupported_content_type');

  try {
    const found = await sb(
      `/tenants?id=eq.${body.tenantId}&select=id,status`,
      {},
      opsContext(body.tenantId),
    );
    if (!found?.length || found[0].status === 'archived') return bad('tenant_not_found', 404);

    const path = `${body.tenantId}/${body.kind}/${randomUUID()}.${ext}`;
    const base = `${process.env.SUPABASE_URL}/storage/v1`;
    // The Vercel Supabase integration names it SUPABASE_SERVICE_ROLE_KEY.
    const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!process.env.SUPABASE_URL || !key) throw new Error('storage is not configured');

    const res = await fetch(`${base}/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const signed = await res.json().catch(() => null);
    if (!res.ok || typeof signed?.url !== 'string') {
      throw new Error(`storage sign ${res.status}: ${JSON.stringify(signed)?.slice(0, 200)}`);
    }

    return ok({
      path,
      uploadUrl: `${base}${signed.url}`,
      publicUrl: `${base}/object/public/${BUCKET}/${path}`,
    });
  } catch (e) {
    return dbFailure('ops-assets', e);
  }
};

export default webHandler(handler);
