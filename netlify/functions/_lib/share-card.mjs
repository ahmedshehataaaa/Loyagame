/* Link-preview card for /play/<slug>/.

   WhatsApp, Instagram, Facebook, Telegram, etc. read <meta property="og:*"> from the raw HTML and
   never run JS, so every tenant page used to preview as "McSlice Rush" (index.html's static head).
   vercel.json routes ONLY those crawlers' requests for /play/<slug>/ to
   /api/tenant-config?share=1, which answers with this tiny page. Players never see it, and if one
   ever does, the meta refresh takes them to the game. Never add in-app-browser tokens such as
   "Instagram" or "Pinterest" to that UA list: those are real players opening the link. */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Absolute https URL for a manifest asset (logos may be stored relative to the game root). */
export function absoluteAsset(origin, path) {
  if (!path) return `${origin}/icon.svg`;
  if (/^https?:\/\//.test(path)) return path;
  return `${origin}/${String(path).replace(/^\/+/, '')}`;
}

/** @param {{origin: string, slug: string, name: string, manifest: any}} o */
export function shareCardHtml({ origin, slug, name, manifest }) {
  const brand = manifest?.brand ?? {};
  const brandName = brand.name || name || 'ClaimLabs';
  const game = brand.gameName || 'Slice Rush';
  const title = `${game} · ${brandName}`;
  const desc = brand.tagline || `Play ${game} and win real rewards from ${brandName}.`;
  const url = `${origin}/play/${slug}/`;
  const image = absoluteAsset(origin, brand.logo);
  const color = /^#[0-9a-f]{6}$/i.test(brand.colors?.primary ?? '') ? brand.colors.primary : '#111111';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${color}">
<link rel="canonical" href="${esc(url)}">
<meta http-equiv="refresh" content="0;url=${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(brandName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
</head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`;
}
