/* ============================================================
   Campaign loader — turns a validated manifest into engine config.

   The reskin surface used to be `engine/config.js` itself: a hand-edited JS
   file. That works for one client and stops working at two, because there
   is no way to ship a second restaurant without either forking the file or
   editing the shipped build. A manifest makes the brand a DATA input.

   HOW THIS COEXISTS WITH engine/config.js
   `engine/config.js` remains the tuning + fallback surface: gravity, spawn
   curve, effect budgets, and a complete McDonald's brand block that works
   with no manifest at all. The loader OVERLAYS a manifest's brand/content
   onto it. That ordering is deliberate — the game must stay bootable if a
   manifest is missing, malformed or unreachable, and a campaign should not
   be able to break physics.

   FAIL-CLOSED ON MONEY, FAIL-OPEN ON COSMETICS
   A manifest with validation ERRORS is rejected wholesale and the built-in
   config stands, because a half-applied campaign is worse than none: it
   could pair one restaurant's prizes with another's threshold. Warnings are
   logged and the campaign still applies.
   ============================================================ */

import { validateCampaign, formatIssues } from './schema.js';

/** @typedef {import('./schema.js').ValidationResult} ValidationResult */

/** What was actually applied, for diagnostics and tests. */
let applied = null;
export const appliedCampaign = () => applied;

/**
 * Is the campaign live right now?
 *
 * Absent dates mean always-on. Kept separate from validation because a
 * campaign that has ended is *valid* — it just should not be playable, and
 * that is a different decision for the caller to make.
 */
export function isCampaignLive(campaign, now = new Date()) {
  if (!campaign) return true;
  const t = now.getTime();
  if (campaign.startsAt && t < new Date(campaign.startsAt).getTime()) return false;
  if (campaign.endsAt && t > new Date(campaign.endsAt).getTime()) return false;
  return true;
}

/**
 * Map a validated manifest onto the shapes the engine already reads.
 *
 * Returns plain objects rather than mutating, so callers can diff or test the
 * mapping without a live engine.
 */
export function toEngineShape(value) {
  const { brand, items, hazard, rules, rewards } = value;

  return {
    FOODS: items.map((i) => ({
      id: i.id,
      img: i.img,
      glyph: i.glyph ?? '🍔', // fallback only if a sprite fails to load
      points: i.points,
      radius: i.radius,
      juice: i.juice ?? '#d8892f',
      label: i.label,
      ...(i.hero ? { hero: true } : {}),
    })),

    BOMB: {
      id: hazard.id,
      img: hazard.img,
      glyph: hazard.glyph ?? '💣',
      radius: hazard.radius,
      juice: hazard.juice ?? '#2b1a10',
      label: hazard.label ?? 'Avoid!',
    },

    BRAND: {
      name: brand.name,
      gameName: brand.gameName,
      tagline: brand.tagline,
      knife: brand.knife,
      colors: {
        primary: brand.colors.primary,
        primary2: brand.colors.primary2,
        accent: brand.colors.accent,
        accent2: brand.colors.accent2,
        // Retained for engine call sites that still expect them.
        green: '#3fb84e',
        green2: '#2c8e3e',
        sky1: brand.colors.surface,
        sky2: brand.colors.primary,
        sky3: brand.colors.primary2,
      },
      ink: brand.colors.ink,
    },

    ROUND_TIME: rules.roundSeconds,
    START_LIVES: rules.lives,

    WHEEL: {
      enabled: brand.features?.wheel !== false,
      pointsThreshold: rewards.pointsThreshold,
      // Glyphs are cosmetic and not part of the manifest contract: the label is
      // what the player is told and what staff hand over.
      prizes: rewards.prizes.map((p) => ({
        key: p.key,
        glyph: p.glyph ?? '🎁',
        label: p.label,
        weight: p.weight,
      })),
    },
  };
}

/**
 * Push brand colours into CSS custom properties.
 *
 * Kept here rather than in the stylesheet so a campaign needs no CSS build
 * step — the tokens file defines the McDonald's values as its own defaults and
 * these override them at runtime.
 */
export function applyBrandTokens(brand, root = document?.documentElement) {
  if (!root || !brand?.colors) return;
  const map = {
    '--c-primary': brand.colors.primary,
    '--c-primary-dark': brand.colors.primary2,
    '--c-secondary': brand.colors.accent,
    '--c-secondary-dark': brand.colors.accent2,
    '--c-ink': brand.colors.ink,
    '--c-surface': brand.colors.surface,
  };
  for (const [prop, val] of Object.entries(map)) {
    if (val) root.style.setProperty(prop, val);
  }
}

/**
 * Apply a manifest to the live engine globals.
 *
 * @param {any} manifest
 * @param {{onIssues?:(r:ValidationResult)=>void}} [opts]
 * @returns {ValidationResult}
 */
export function applyCampaign(manifest, opts = {}) {
  const result = validateCampaign(manifest);
  opts.onIssues?.(result);

  if (!result.ok) {
    // Rejected wholesale — see the header note on fail-closed.
    console.error(`Campaign manifest rejected; keeping built-in config.\n${formatIssues(result)}`);
    return result;
  }

  if (result.warnings.length) {
    console.warn(`Campaign manifest applied with warnings:\n${formatIssues(result)}`);
  }

  const shaped = toEngineShape(result.value);

  // Overlay onto the existing config rather than replacing it, so tuning the
  // manifest does not carry a way to break gravity or the spawn curve.
  if (window.CONFIG) {
    window.CONFIG.ROUND_TIME = shaped.ROUND_TIME;
    window.CONFIG.START_LIVES = shaped.START_LIVES;
    window.CONFIG.WHEEL = { ...window.CONFIG.WHEEL, ...shaped.WHEEL };
  }
  window.FOODS = shaped.FOODS;
  window.BOMB = shaped.BOMB;
  window.BRAND = shaped.BRAND;

  applyBrandTokens(result.value.brand);

  applied = result.value;
  return result;
}

/**
 * Fetch and apply a manifest.
 *
 * Never rejects: a missing or unreachable manifest leaves the built-in config
 * in place, which is exactly the behaviour that keeps a demo build and an
 * offline first load working.
 */
export async function loadCampaign(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`Campaign manifest ${url} -> ${res.status}; keeping built-in config.`);
      return null;
    }
    return applyCampaign(await res.json());
  } catch (err) {
    console.warn(`Campaign manifest ${url} could not be loaded; keeping built-in config.`, err);
    return null;
  }
}
