/* ClaimLabs ops API — tenant onboarding and management (ADR 0018).
   Auth: x-ops-key (OPS_ADMIN_KEY), compared in constant time. The only
   caller is the ops dashboard's server; the key never reaches a browser.

   GET                  -> cross-tenant overview
   GET ?slug=<slug>     -> one tenant: published config, versions, audit trail
   GET ?presets=1       -> reward presets
   POST { action, actor, ... }
     create        { name, slug, gameFormat, couponPrefix }
     save_draft    { tenantId, manifest, rewardPresetId, prizeLabels }
     preview       { slug, versionId }          -> { token, path }
     publish       { versionId }
     set_status    { tenantId, status }
     rotate_keys   { tenantId, keys: ["admin"|"pos"] } -> plaintext, shown ONCE
     review_preset { presetId }

   Every write is a single ops_* function (database/migrations/0005), which
   enforces the business rules under a row lock. This handler checks shape,
   validates the manifest with the same validator the game uses, and passes
   the database's reason codes back unchanged. */
import { randomBytes } from 'node:crypto';
import {
  rpc,
  ok,
  bad,
  readBody,
  isOpsAdmin,
  opsContext,
  dbFailure,
  signPreviewToken,
  sha256hex,
  SLUG_RE,
  UUID_RE,
} from '../lib/db.mjs';
import { validateCampaign } from '../src/campaign/schema.js';
import { webHandler } from '../lib/http.mjs';

const STATUSES = new Set(['trial', 'active', 'paused', 'archived']);
const FORMATS = new Set(['slice_rush', 'catch_fries']);

/* Rewards are composed by the database from a reviewed preset, so the manifest
   is validated with a stand-in rewards block: this checks brand, items, hazard,
   rules and dates, and the database checks the money. */
function manifestIssues(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [{ path: '', message: 'manifest must be an object' }];
  }
  const result = validateCampaign({
    ...manifest,
    rewards: { pointsThreshold: 1, prizes: [{ key: 'placeholder', label: 'placeholder', weight: 1 }] },
  });
  return result.ok ? null : result.errors;
}

const isVersionId = (v) => Number.isSafeInteger(v) && v > 0;

const handler = async (req) => {
  if (!isOpsAdmin(req)) return bad('unauthorized', 401);
  const ctx = opsContext();

  try {
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams;
      if (params.get('presets')) {
        return ok({ presets: await rpc('ops_list_presets', {}, ctx) });
      }
      const slug = params.get('slug');
      if (slug) {
        if (!SLUG_RE.test(slug)) return bad('invalid_tenant');
        const detail = await rpc('ops_tenant_detail', { p_slug: slug }, ctx);
        if (!detail) return bad('tenant_not_found', 404);
        return ok({ detail });
      }
      return ok({ tenants: await rpc('ops_overview', {}, ctx) });
    }

    if (req.method !== 'POST') return bad('method_not_allowed', 405);
    const body = await readBody(req);
    if (!body?.action) return bad('action_required');
    // Every change is attributed to a named person in tenant_events.
    const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (!actor) return bad('actor_required');

    switch (body.action) {
      case 'create': {
        if (typeof body.name !== 'string' || !body.name.trim()) return bad('invalid_name');
        if (!SLUG_RE.test(body.slug ?? '')) return bad('invalid_slug');
        if (!FORMATS.has(body.gameFormat)) return bad('invalid_game_format');
        const tenant = await rpc(
          'ops_create_tenant',
          {
            p_name: body.name,
            p_slug: body.slug,
            p_game_format: body.gameFormat,
            p_coupon_prefix: String(body.couponPrefix ?? ''),
            p_actor: actor,
          },
          ctx,
        );
        return ok({ tenant });
      }

      case 'save_draft': {
        if (!UUID_RE.test(body.tenantId ?? '')) return bad('invalid_tenant');
        const issues = manifestIssues(body.manifest);
        if (issues) return new Response(JSON.stringify({ ok: false, error: 'invalid_manifest', issues }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
        const draft = await rpc(
          'ops_save_draft',
          {
            p_tenant_id: body.tenantId,
            p_manifest: body.manifest,
            p_reward_preset_id: String(body.rewardPresetId ?? ''),
            p_prize_labels: body.prizeLabels ?? {},
            p_actor: actor,
          },
          ctx,
        );
        return ok(draft);
      }

      case 'preview': {
        if (!SLUG_RE.test(body.slug ?? '') || !isVersionId(body.versionId)) {
          return bad('invalid_preview');
        }
        const manifest = await rpc('ops_version_manifest', { p_version_id: body.versionId }, ctx);
        if (manifest?.brand?.id !== body.slug) return bad('version_not_found', 404);
        const token = signPreviewToken(body.slug, body.versionId);
        return ok({ token, path: `/play/${body.slug}/?preview=${encodeURIComponent(token)}`, manifest });
      }

      case 'publish': {
        if (!isVersionId(body.versionId)) return bad('invalid_version');
        return ok(await rpc('ops_publish_version', { p_version_id: body.versionId, p_actor: actor }, ctx));
      }

      case 'set_status': {
        if (!UUID_RE.test(body.tenantId ?? '')) return bad('invalid_tenant');
        if (!STATUSES.has(body.status)) return bad('invalid_status');
        return ok(
          await rpc(
            'ops_set_tenant_status',
            { p_tenant_id: body.tenantId, p_status: body.status, p_actor: actor },
            ctx,
          ),
        );
      }

      case 'rotate_keys': {
        if (!UUID_RE.test(body.tenantId ?? '')) return bad('invalid_tenant');
        const keys = new Set(Array.isArray(body.keys) ? body.keys : []);
        if (keys.size === 0 || [...keys].some((k) => k !== 'admin' && k !== 'pos')) {
          return bad('invalid_keys');
        }
        const adminKey = keys.has('admin') ? `clk_${randomBytes(24).toString('base64url')}` : null;
        const posSecret = keys.has('pos') ? `clp_${randomBytes(24).toString('base64url')}` : null;
        await rpc(
          'ops_rotate_keys',
          {
            p_tenant_id: body.tenantId,
            p_admin_key_hash: adminKey && sha256hex(adminKey),
            p_pos_secret_hash: posSecret && sha256hex(posSecret),
            p_actor: actor,
          },
          ctx,
        );
        // The only time these values exist outside the caller: only hashes are stored.
        return ok({ adminKey, posSecret });
      }

      case 'review_preset': {
        if (typeof body.presetId !== 'string' || !body.presetId) return bad('invalid_preset');
        return ok(await rpc('ops_review_preset', { p_preset_id: body.presetId, p_reviewer: actor }, ctx));
      }

      default:
        return bad('unknown_action');
    }
  } catch (e) {
    return dbFailure('ops-tenants', e);
  }
};

export default webHandler(handler);
