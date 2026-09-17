/* ============================================================
   Which tenant this page belongs to — read once, from the URL path.

   /play/<slug>/ serves the same static build for every restaurant onboarded
   through the ops dashboard (ADR 0018). The site root, with no slug, is the
   McDonald's build exactly as it shipped before multi-tenancy.

   Everything here returns what the root build already used when there is no
   slug — the same storage keys, no tenant header — so the McDonald's build is
   unchanged by this module's existence.
   ============================================================ */

/** Same rule as tenants.slug and brand.id in src/campaign/schema.js. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/**
 * @param {string} pathname
 * @returns {string|null}
 */
export function tenantSlugFrom(pathname) {
  const m = /^\/play\/([^/]+)(?:\/|$)/.exec(pathname || '');
  return m && SLUG_RE.test(m[1]) ? m[1] : null;
}

/** @type {string|null|undefined} */
let cached;

/** The current page's tenant, or null for the root (McDonald's) build. */
export function tenantSlug() {
  if (cached === undefined) {
    try {
      cached = tenantSlugFrom(location.pathname);
    } catch {
      cached = null; // no location (Node, tests): the root build
    }
  }
  return cached;
}

/**
 * A localStorage key for this tenant.
 *
 * localStorage is shared by every path on an origin, so without this a player's
 * identity, device id and cached balance from one restaurant's page would be
 * read by another's. With no tenant the key is returned unchanged.
 *
 * @param {string} base
 * @param {string|null} [slug]
 */
export function tenantKey(base, slug = tenantSlug()) {
  return slug ? `${base}@${slug}` : base;
}
