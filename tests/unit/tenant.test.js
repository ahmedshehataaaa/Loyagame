import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { tenantSlugFrom, tenantKey, tenantSlug } from '../../src/core/tenant.js';
import { loadTenantCampaign } from '../../src/campaign/loader.js';

/* The client half of tenant isolation (ADR 0018): which tenant a page is, how
   its storage is namespaced, and when a tenant manifest may be applied. */

const DEMO = JSON.parse(readFileSync('campaigns/example-reskin.json', 'utf8')); // brand.id demo-diner

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tenantSlugFrom', () => {
  it('reads /play/<slug>/ with or without the trailing slash', () => {
    expect(tenantSlugFrom('/play/demo-diner/')).toBe('demo-diner');
    expect(tenantSlugFrom('/play/demo-diner')).toBe('demo-diner');
    expect(tenantSlugFrom('/play/demo-diner/index.html')).toBe('demo-diner');
  });

  it('the site root and every other path are the root build', () => {
    for (const p of ['/', '/index.html', '/play', '/play/', '/assets/play/x', '', undefined]) {
      expect(tenantSlugFrom(/** @type {any} */ (p)), String(p)).toBeNull();
    }
  });

  it('refuses a slug that is not URL- and storage-safe', () => {
    for (const p of ['/play/Demo/', '/play/a/', '/play/..%2F/', '/play/demo diner/', '/play/-x/']) {
      expect(tenantSlugFrom(p), p).toBeNull();
    }
  });

  it('with no location (Node) the page is the root build', () => {
    expect(tenantSlug()).toBeNull();
  });
});

describe('tenantKey', () => {
  it('leaves root keys exactly as they were, so existing players keep their data', () => {
    expect(tenantKey('mcslice.v1', null)).toBe('mcslice.v1');
    expect(tenantKey('mcslice.identity.v1')).toBe('mcslice.identity.v1');
  });

  it('gives each tenant its own key', () => {
    expect(tenantKey('mcslice.identity.v1', 'demo-diner')).toBe('mcslice.identity.v1@demo-diner');
    expect(tenantKey('mcslice.identity.v1', 'demo-diner')).not.toBe(
      tenantKey('mcslice.identity.v1', 'nile-cafe'),
    );
  });
});

describe('loadTenantCampaign', () => {
  /** A minimal browser for applyCampaign to write into. */
  function fakeBrowser() {
    const win = { CONFIG: { ROUND_TIME: 30, START_LIVES: 2, WHEEL: {} }, BRAND: { name: "McDonald's" } };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { documentElement: { style: { setProperty: () => {} } } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return win;
  }

  const respond = (status, body) => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('applies a manifest for exactly the tenant in the URL', async () => {
    const win = fakeBrowser();
    const r = await loadTenantCampaign('demo-diner', {
      fetchImpl: respond(200, { ok: true, manifest: DEMO }),
    });
    expect(r?.ok).toBe(true);
    expect(win.BRAND.name).toBe('Demo Diner');
    expect(win.CONFIG.ROUND_TIME).toBe(45);
  });

  it('asks for the draft when previewing', async () => {
    fakeBrowser();
    const fetchImpl = vi.fn(/** @param {string} _url */ (_url) => respond(200, { ok: true, manifest: DEMO })());
    await loadTenantCampaign('demo-diner', { preview: 'tok.en', fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/tenant-config?slug=demo-diner&preview=tok.en');
  });

  it("refuses a manifest describing a different brand — never another tenant's skin", async () => {
    const win = fakeBrowser();
    const r = await loadTenantCampaign('acme-burger', {
      fetchImpl: respond(200, { ok: true, manifest: DEMO }),
    });
    expect(r).toBeNull();
    expect(win.BRAND.name).toBe("McDonald's");
  });

  it('returns null, applying nothing, when the tenant is unavailable or unreachable', async () => {
    const win = fakeBrowser();
    expect(
      await loadTenantCampaign('demo-diner', { fetchImpl: respond(404, { ok: false, error: 'not_available' }) }),
    ).toBeNull();
    expect(
      await loadTenantCampaign('demo-diner', {
        fetchImpl: async () => {
          throw new TypeError('network down');
        },
      }),
    ).toBeNull();
    expect(win.BRAND.name).toBe("McDonald's");
  });

  it('reports an invalid manifest as not ok, so the caller refuses to route', async () => {
    const win = fakeBrowser();
    const broken = { ...DEMO, rewards: { prizes: [] } };
    const r = await loadTenantCampaign('demo-diner', { fetchImpl: respond(200, { ok: true, manifest: broken }) });
    expect(r?.ok).toBe(false);
    expect(win.BRAND.name).toBe("McDonald's");
  });
});
