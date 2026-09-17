import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  asOps,
  asRole,
  manifestFor,
  STANDARD_LABELS,
  LEGACY_TENANT,
} from './support/stack.js';

/* The rules the onboarding wizard relies on, enforced in the database so they
 * hold no matter what calls them. */

let stack;
const ACTOR = 'Youssef Kamal';

const ops = (sql, params = []) =>
  asOps(stack.admin, async (c) => Object.values((await c.query(sql, params)).rows[0] ?? {})[0]);

const createTenant = (slug, prefix = 'TT', format = 'slice_rush') =>
  ops('select ops_create_tenant($1, $2, $3::game_format, $4, $5)', [
    `Tenant ${slug}`,
    slug,
    format,
    prefix,
    ACTOR,
  ]);

/**
 * @param {string} tenantId
 * @param {string} slug
 * @param {{labels?: Record<string, string>, preset?: string, manifest?: any}} [opts]
 */
const saveDraft = (tenantId, slug, { labels = STANDARD_LABELS, preset = 'standard-10', manifest } = {}) =>
  ops('select ops_save_draft($1, $2, $3, $4, $5)', [
    tenantId,
    manifest ?? manifestFor(slug),
    preset,
    labels,
    ACTOR,
  ]);

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack?.stop();
});

describe('creating a tenant', () => {
  it('creates it in trial, with default settings and an audit event', async () => {
    const t = await createTenant('koshary-king', 'KK');
    expect(t).toMatchObject({ slug: 'koshary-king', status: 'trial' });

    const { rows } = await stack.admin.query('select key from settings where tenant_id = $1 order by key', [t.id]);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('round_time_sec');
    // No prizes until a reviewed preset is published.
    expect(keys).not.toContain('wheel_prizes');
    expect(keys).not.toContain('wheel_points_threshold');

    const events = await stack.admin.query('select action, actor from tenant_events where tenant_id = $1', [t.id]);
    expect(events.rows).toEqual([{ action: 'created', actor: ACTOR }]);
  });

  it('refuses Catch the Fries — the format is declared, the engine is not built', async () => {
    await expect(createTenant('fries-co', 'FC', 'catch_fries')).rejects.toThrow(/game_format_unavailable/);
  });

  it('refuses a slug that would shadow a real path', async () => {
    await expect(createTenant('assets', 'AS')).rejects.toThrow(/slug_reserved/);
    await expect(createTenant('api', 'AP')).rejects.toThrow(/slug_reserved/);
  });

  it('refuses a taken slug, an unsafe slug and a malformed coupon prefix', async () => {
    await expect(createTenant('mcdonalds', 'MM')).rejects.toThrow(/slug_taken/);
    await expect(createTenant('Bad Slug', 'BS')).rejects.toThrow(/tenants_slug_check/);
    await expect(createTenant('good-slug', 'toolong')).rejects.toThrow(/coupon_prefix_check/);
  });

  it('requires a named actor for the audit trail', async () => {
    await expect(
      ops("select ops_create_tenant('X', 'no-actor', 'slice_rush', 'NA', '  ')"),
    ).rejects.toThrow(/actor_required/);
  });
});

describe('drafts', () => {
  it("must be for the tenant's own brand id", async () => {
    const t = await createTenant('mismatch-co', 'MX');
    await expect(
      saveDraft(t.id, 'mismatch-co', { manifest: manifestFor('someone-else') }),
    ).rejects.toThrow(/manifest_brand_mismatch/);
  });

  it('must name every relabelable prize tier', async () => {
    const t = await createTenant('unlabelled', 'UL');
    const labels = { ...STANDARD_LABELS };
    delete labels.side1;
    await expect(saveDraft(t.id, 'unlabelled', { labels })).rejects.toThrow(
      /prize_label_missing:side1/,
    );
  });

  it('never stores odds from the form: a rewards block in the manifest is dropped', async () => {
    const t = await createTenant('sneaky-odds', 'SO');
    const manifest = {
      ...manifestFor('sneaky-odds'),
      rewards: { pointsThreshold: 1, prizes: [{ key: 'car', label: 'Free car', weight: 100 }] },
    };
    const { versionId } = await saveDraft(t.id, 'sneaky-odds', { manifest });
    const { rows } = await stack.admin.query('select manifest from tenant_config_versions where id = $1', [
      versionId,
    ]);
    expect(rows[0].manifest.rewards).toBeUndefined();
  });

  it('the preview manifest composes rewards from the preset', async () => {
    const t = await createTenant('preview-co', 'PV');
    const { versionId } = await saveDraft(t.id, 'preview-co');
    const manifest = await ops('select ops_version_manifest($1)', [versionId]);
    expect(manifest.rewards.pointsThreshold).toBe(4000);
    expect(manifest.rewards.prizes).toHaveLength(10);
    expect(manifest.rewards.prizes.find((p) => p.key === 'side1').label).toBe('Free Fries');
  });
});

describe('publishing', () => {
  it('requires a REVIEWED preset', async () => {
    const t = await createTenant('too-early', 'TE');
    const { versionId } = await saveDraft(t.id, 'too-early');
    // standard-10 ships as a draft; nobody has reviewed it in this database yet.
    await expect(ops('select ops_publish_version($1, $2)', [versionId, ACTOR])).rejects.toThrow(
      /preset_not_reviewed/,
    );
  });

  it('a review records who signed it off, and happens once', async () => {
    const r = await ops("select ops_review_preset('standard-10', 'Jana Mostafa')");
    expect(r).toMatchObject({ status: 'reviewed', reviewedBy: 'Jana Mostafa' });
    await expect(ops("select ops_review_preset('standard-10', 'Jana Mostafa')")).rejects.toThrow(
      /preset_not_draft/,
    );
  });

  it("a reviewed preset's odds cannot be edited in place", async () => {
    await expect(
      asOps(stack.admin, (c) => c.query("update reward_presets set points_threshold = 10 where id = 'standard-10'")),
    ).rejects.toThrow(/preset_locked/);
  });

  it('writes the published manifest and the server-side prize settings together', async () => {
    const t = await createTenant('grill-house', 'GH');
    const labels = { ...STANDARD_LABELS, off5: '50% off everything' }; // not relabelable
    const { versionId } = await saveDraft(t.id, 'grill-house', {
      labels,
      manifest: manifestFor('grill-house', { roundSeconds: 45 }),
    });
    await ops('select ops_publish_version($1, $2)', [versionId, ACTOR]);

    const tenant = (await stack.admin.query('select * from tenants where id = $1', [t.id])).rows[0];
    expect(tenant.published_version_id).toBe(String(versionId));
    expect(tenant.brand_config.brand.id).toBe('grill-house');

    const settings = Object.fromEntries(
      (await stack.admin.query('select key, value from settings where tenant_id = $1', [t.id])).rows.map((r) => [
        r.key,
        r.value,
      ]),
    );
    expect(settings.wheel_points_threshold).toBe(4000);
    // submit-run derives survival from this; it must match the manifest.
    expect(settings.round_time_sec).toBe(45);
    expect(settings.wheel_prizes.map((p) => p.weight)).toEqual([28, 20, 18, 12, 9, 6, 4, 2, 0.8, 0.2]);
    expect(settings.wheel_prizes.find((p) => p.key === 'off5').label).toBe('5% off your order');
    expect(settings.wheel_prizes).toEqual(tenant.brand_config.rewards.prizes);
  });

  it('a second publish supersedes the first; exactly one version is live', async () => {
    const t = await createTenant('two-versions', 'TV');
    const v1 = await saveDraft(t.id, 'two-versions');
    await ops('select ops_publish_version($1, $2)', [v1.versionId, ACTOR]);
    const v2 = await saveDraft(t.id, 'two-versions', { labels: { ...STANDARD_LABELS, side1: 'Free Onion Rings' } });
    await ops('select ops_publish_version($1, $2)', [v2.versionId, ACTOR]);

    const { rows } = await stack.admin.query(
      'select id, state from tenant_config_versions where tenant_id = $1 order by id',
      [t.id],
    );
    expect(rows.map((r) => r.state)).toEqual(['superseded', 'published']);
    await expect(ops('select ops_publish_version($1, $2)', [v1.versionId, ACTOR])).rejects.toThrow(
      /version_not_draft/,
    );
  });

  it('refuses a manifest round length the game could not run', async () => {
    const t = await createTenant('bad-round', 'BR');
    const { versionId } = await saveDraft(t.id, 'bad-round', {
      manifest: { ...manifestFor('bad-round'), rules: { roundSeconds: 2, lives: 2 } },
    });
    await expect(ops('select ops_publish_version($1, $2)', [versionId, ACTOR])).rejects.toThrow(
      /invalid_round_seconds/,
    );
  });
});

describe('status', () => {
  it('an unpublished tenant cannot go active', async () => {
    const t = await createTenant('not-ready', 'NR');
    await expect(ops("select ops_set_tenant_status($1, 'active', $2)", [t.id, ACTOR])).rejects.toThrow(
      /not_published/,
    );
  });

  it('an archived tenant comes back paused, never straight to live', async () => {
    const t = await createTenant('archive-me', 'AR');
    await ops("select ops_set_tenant_status($1, 'archived', $2)", [t.id, ACTOR]);
    await expect(ops("select ops_set_tenant_status($1, 'trial', $2)", [t.id, ACTOR])).rejects.toThrow(
      /archived_tenant_must_be_paused_first/,
    );
    expect(await ops("select ops_set_tenant_status($1, 'paused', $2)", [t.id, ACTOR])).toMatchObject({
      status: 'paused',
    });
  });

  it("McDonald's stays activatable without a published manifest — it boots from the built-in config", async () => {
    await ops("select ops_set_tenant_status($1, 'paused', $2)", [LEGACY_TENANT, ACTOR]);
    expect(await ops("select ops_set_tenant_status($1, 'active', $2)", [LEGACY_TENANT, ACTOR])).toMatchObject({
      status: 'active',
    });
  });

  it('the public config is served only while published and live', async () => {
    const t = await createTenant('lights-out', 'LO');
    const { versionId } = await saveDraft(t.id, 'lights-out');
    const config = () =>
      asRole(stack.admin, 'tenant_resolver', { role: 'tenant_resolver' }, async (c) =>
        (await c.query("select tenant_published_config('lights-out') as c")).rows[0].c,
      );

    expect(await config()).toBeNull(); // not published
    await ops('select ops_publish_version($1, $2)', [versionId, ACTOR]);
    expect((await config()).manifest.brand.id).toBe('lights-out');
    await ops("select ops_set_tenant_status($1, 'paused', $2)", [t.id, ACTOR]);
    expect(await config()).toBeNull(); // paused
  });

  it('records every change in the audit trail', async () => {
    const detail = await ops("select ops_tenant_detail('lights-out')");
    expect(detail.events.map((e) => e.action)).toEqual(['status_changed', 'published', 'draft_saved', 'created']);
    expect(detail.tenant.hasAdminKey).toBe(false);
    expect(JSON.stringify(detail)).not.toMatch(/key_hash|secret_hash/);
  });
});
