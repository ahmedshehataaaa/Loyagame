/* ============================================================
   Brand copy for the player screens — logo, slogan, prize teaser, hero art.

   The root build keeps its translated McDonald's strings and art exactly as
   they shipped. A tenant page (/play/<slug>/, ADR 0018) takes them from its own
   manifest instead, because the i18n tables and the hard-coded sprite paths
   ARE McDonald's: showing them on another restaurant's page would be a brand
   leak, not a fallback.
   ============================================================ */
import { appliedCampaign } from './loader.js';
import { tenantSlug } from '../core/tenant.js';
import { t } from '../core/i18n.js';

const ROOT_HERO = 'assets/Mac character.png';

/** The applied manifest when this is a tenant page, else null. */
function tenantManifest() {
  return tenantSlug() ? appliedCampaign() : null;
}

export function brandLogo() {
  const m = tenantManifest();
  return m
    ? { src: m.brand.logo || 'assets/brand-logo.png', alt: m.brand.name }
    : { src: 'assets/brand-logo.png', alt: "McDonald's" };
}

const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* Tenant names and prize labels are data, usually Latin, dropped into a
   sentence that may be Arabic. Without an isolate the bidi algorithm lets them
   swallow neighbouring punctuation: "Jimmy's Slice Master!" rendered as
   "!Jimmy's Slice Master" on the RTL welcome screen. FSI … PDI keeps each
   one a self-contained run in either direction. */
const isolate = (v) => `⁨${v}⁩`;

/** Welcome headline, as HTML (it carries a line break). The game name is data. */
export function welcomeTitleHtml() {
  const m = tenantManifest();
  return m ? t('welcome.titleBrand', { game: `<bdi>${escapeHtml(m.brand.gameName)}</bdi>` }) : t('welcome.title');
}

export function brandSlogan() {
  const m = tenantManifest();
  return m ? m.brand.slogan || m.brand.tagline || '' : t('welcome.slogan');
}

export function prizeTeaser() {
  const m = tenantManifest();
  if (!m) return t('welcome.prizeTeaser');
  const labels = m.rewards.prizes.map((p) => p.label);
  if (m.brand.features?.wheel === false || !labels.length) {
    return t('welcome.prizeTeaserBrand', { brand: isolate(m.brand.name) });
  }
  return labels.length === 1
    ? t('welcome.prizeTeaserOne', { prize: isolate(labels[0]) })
    : t('welcome.prizeTeaserRange', { from: isolate(labels[0]), to: isolate(labels[labels.length - 1]) });
}

/* The hazard rule. The root strings name McDonald's burnt fries; a tenant's
   hazard is whatever its manifest throws, so its pages use neutral wording. */
export function hazardRule(lives) {
  return tenantManifest()
    ? { icon: 'alert', text: t('howTo.avoidBrand', { lives }) }
    : { icon: 'fries', text: t('howTo.avoid', { lives }) };
}

export function playHint() {
  return t(tenantManifest() ? 'play.hintBrand' : 'play.hint');
}

/** The welcome hero: the root mascot, or the tenant's hero item (else its first). */
export function heroImage() {
  const m = tenantManifest();
  if (!m) return ROOT_HERO;
  return (m.items.find((i) => i.hero) ?? m.items[0])?.img ?? m.brand.logo;
}
