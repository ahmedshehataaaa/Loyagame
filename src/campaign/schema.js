/* ============================================================
   Campaign manifest schema + validator.

   The product promise is ONE engine reskinned per restaurant through
   configuration, not a fork per client. Today that promise is only
   half-kept: `engine/config.js` is the reskin surface, but it is a
   hand-edited JS file with no schema, no validation and no defaults — so
   the failure mode of a new client build is a silently broken game
   (missing sprite, `undefined` colour, a prize list whose weights don't
   sum) rather than a loud complaint at load.

   This is a validator, deliberately not a framework: no dependencies, no
   codegen, and it runs in the browser and in Node so the same check guards
   both the app and CI.

   Two rules shape it:

   1. **Fail loudly on anything that affects money or fairness** — prize
      weights, point thresholds, round rules. A wrong value here is a
      financial or legal problem, so it is an ERROR and the campaign is
      rejected.
   2. **Fall back quietly on anything cosmetic** — a missing accent colour
      or tagline is a WARNING with a safe default. Refusing to boot a
      restaurant's game because a hex code is absent would be the wrong
      trade.
   ============================================================ */

/** @typedef {{path:string, message:string}} Issue */
/** @typedef {{ok:boolean, errors:Issue[], warnings:Issue[], value:any}} ValidationResult */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Cosmetic defaults. Anything here is safe to be missing. */
export const COSMETIC_DEFAULTS = Object.freeze({
  tagline: '',
  slogan: '',
  knife: '🔪',
  colors: Object.freeze({
    primary: '#DA291C',
    primary2: '#A81A10',
    accent: '#FFC72C',
    accent2: '#C8930A',
    ink: '#27251F',
    surface: '#FFF8F6',
  }),
  locales: Object.freeze(['en']),
  features: Object.freeze({
    wheel: true,
    leaderboard: true,
    soundDefault: true,
  }),
});

/* ---- Individual field checks ------------------------------------------- */

function checkBrand(brand, errors, warnings) {
  if (!isObj(brand)) {
    errors.push({ path: 'brand', message: 'brand must be an object' });
    return {};
  }
  const out = { ...COSMETIC_DEFAULTS, ...brand };

  // Identity is load-bearing: an unnamed campaign cannot be attributed.
  if (!isStr(brand.id)) errors.push({ path: 'brand.id', message: 'required, non-empty string' });
  else if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(brand.id)) {
    errors.push({
      path: 'brand.id',
      message: 'must be lowercase kebab-case, 2-40 chars (used in storage keys and URLs)',
    });
  }
  if (!isStr(brand.name))
    errors.push({ path: 'brand.name', message: 'required, non-empty string' });
  if (!isStr(brand.gameName)) {
    errors.push({ path: 'brand.gameName', message: 'required, non-empty string' });
  }

  // Colours are cosmetic: warn and fall back rather than refusing to boot.
  const colors = { ...COSMETIC_DEFAULTS.colors, ...(isObj(brand.colors) ? brand.colors : {}) };
  for (const [key, value] of Object.entries(colors)) {
    if (!HEX.test(String(value))) {
      warnings.push({
        path: `brand.colors.${key}`,
        message: `"${value}" is not a hex colour — falling back to ${COSMETIC_DEFAULTS.colors[key] ?? '#000000'}`,
      });
      colors[key] = COSMETIC_DEFAULTS.colors[key] ?? '#000000';
    }
  }
  out.colors = colors;

  if (!Array.isArray(brand.locales) || brand.locales.length === 0) {
    warnings.push({ path: 'brand.locales', message: 'missing — defaulting to ["en"]' });
    out.locales = [...COSMETIC_DEFAULTS.locales];
  } else {
    const bad = brand.locales.filter((l) => l !== 'en' && l !== 'ar');
    if (bad.length) {
      warnings.push({
        path: 'brand.locales',
        message: `unsupported locales ignored: ${bad.join(', ')} (supported: en, ar)`,
      });
    }
    out.locales = brand.locales.filter((l) => l === 'en' || l === 'ar');
    if (out.locales.length === 0) out.locales = [...COSMETIC_DEFAULTS.locales];
  }

  out.features = {
    ...COSMETIC_DEFAULTS.features,
    ...(isObj(brand.features) ? brand.features : {}),
  };
  return out;
}

function checkItems(items, errors) {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push({ path: 'items', message: 'at least one sliceable item is required' });
    return [];
  }
  const ids = new Set();
  items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!isObj(item)) {
      errors.push({ path: at, message: 'must be an object' });
      return;
    }
    if (!isStr(item.id)) errors.push({ path: `${at}.id`, message: 'required' });
    else if (ids.has(item.id)) {
      errors.push({ path: `${at}.id`, message: `duplicate item id "${item.id}"` });
    } else ids.add(item.id);

    if (!isStr(item.label)) errors.push({ path: `${at}.label`, message: 'required' });
    if (!isStr(item.img)) errors.push({ path: `${at}.img`, message: 'required (sprite path)' });

    // Points affect the leaderboard, so a bad value is a fairness problem.
    if (!isNum(item.points) || item.points <= 0) {
      errors.push({ path: `${at}.points`, message: 'must be a positive number' });
    }
    if (!isNum(item.radius) || item.radius <= 0) {
      errors.push({ path: `${at}.radius`, message: 'must be a positive number (hit size)' });
    }
  });

  const heroes = items.filter((i) => isObj(i) && i.hero).length;
  if (heroes > 1) {
    errors.push({ path: 'items', message: 'only one item may be the hero' });
  }
  return items;
}

function checkHazard(hazard, errors) {
  if (!isObj(hazard)) {
    errors.push({ path: 'hazard', message: 'required — the game needs something to avoid' });
    return {};
  }
  if (!isStr(hazard.id)) errors.push({ path: 'hazard.id', message: 'required' });
  if (!isStr(hazard.img)) errors.push({ path: 'hazard.img', message: 'required (sprite path)' });
  if (!isNum(hazard.radius) || hazard.radius <= 0) {
    errors.push({ path: 'hazard.radius', message: 'must be a positive number' });
  }
  return hazard;
}

function checkRules(rules, errors, warnings) {
  const out = { roundSeconds: 30, lives: 2, ...(isObj(rules) ? rules : {}) };
  if (!isObj(rules)) {
    warnings.push({ path: 'rules', message: 'missing — defaulting to 30s / 2 lives' });
    return out;
  }
  // Round rules are the game. Wrong values here are not cosmetic.
  if (!isNum(out.roundSeconds) || out.roundSeconds < 5 || out.roundSeconds > 300) {
    errors.push({ path: 'rules.roundSeconds', message: 'must be a number between 5 and 300' });
  }
  if (!Number.isInteger(out.lives) || out.lives < 1 || out.lives > 10) {
    errors.push({ path: 'rules.lives', message: 'must be an integer between 1 and 10' });
  }
  return out;
}

function checkRewards(rewards, errors, warnings) {
  if (!isObj(rewards)) {
    errors.push({ path: 'rewards', message: 'required' });
    return {};
  }

  // The points gate is real money exposure.
  if (!Number.isInteger(rewards.pointsThreshold) || rewards.pointsThreshold < 0) {
    errors.push({
      path: 'rewards.pointsThreshold',
      message: 'must be a non-negative integer (order points needed for a prize)',
    });
  }

  // What the threshold is measured against. Optional; absent means order points,
  // the stricter rule. The server holds its own copy (settings.wheel_gate), so
  // this only words the copy — it cannot open a wheel.
  if (rewards.gate !== undefined && rewards.gate !== 'order_points' && rewards.gate !== 'score') {
    errors.push({ path: 'rewards.gate', message: "must be 'order_points' or 'score'" });
  }

  if (!Array.isArray(rewards.prizes) || rewards.prizes.length === 0) {
    errors.push({ path: 'rewards.prizes', message: 'at least one prize is required' });
    return rewards;
  }

  const keys = new Set();
  let weightSum = 0;
  rewards.prizes.forEach((p, i) => {
    const at = `rewards.prizes[${i}]`;
    if (!isObj(p)) {
      errors.push({ path: at, message: 'must be an object' });
      return;
    }
    if (!isStr(p.key)) errors.push({ path: `${at}.key`, message: 'required' });
    else if (keys.has(p.key)) {
      errors.push({ path: `${at}.key`, message: `duplicate prize key "${p.key}"` });
    } else keys.add(p.key);

    if (!isStr(p.label)) {
      // The label is what a player is told they won and what staff hand over.
      errors.push({ path: `${at}.label`, message: 'required (shown to the player and to staff)' });
    }
    if (!isNum(p.weight) || p.weight <= 0) {
      errors.push({ path: `${at}.weight`, message: 'must be a positive number (draw odds)' });
    } else weightSum += p.weight;
  });

  /* Weights are relative, so they do not have to sum to 100 — but a set that
     nearly does and then misses is almost always a typo in a percentage table,
     and getting it wrong silently changes real prize odds. Warn, don't reject. */
  if (weightSum > 0 && Math.abs(weightSum - 100) > 0.001 && weightSum > 50 && weightSum < 150) {
    warnings.push({
      path: 'rewards.prizes',
      message: `weights sum to ${weightSum}, not 100 — if these are meant to read as percentages, one is wrong`,
    });
  }
  return rewards;
}

function checkCampaign(campaign, errors, warnings) {
  const out = isObj(campaign) ? { ...campaign } : {};
  if (!isObj(campaign)) {
    warnings.push({ path: 'campaign', message: 'missing — treated as always-on' });
    return out;
  }
  const parse = (v, path) => {
    if (v === undefined || v === null) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      errors.push({ path, message: `"${v}" is not a valid ISO date` });
      return null;
    }
    return d;
  };
  const start = parse(campaign.startsAt, 'campaign.startsAt');
  const end = parse(campaign.endsAt, 'campaign.endsAt');
  // A campaign that ends before it starts would never run — and would do so
  // silently, which is the worst way for a promotion to fail.
  if (start && end && end.getTime() <= start.getTime()) {
    errors.push({ path: 'campaign.endsAt', message: 'must be after campaign.startsAt' });
  }
  return out;
}

/**
 * Validate a campaign manifest.
 *
 * Always returns a result; never throws. Callers decide what to do with
 * `ok === false`, because "refuse to boot" and "boot with defaults" are
 * different correct answers in different places (see loader.js).
 *
 * @param {any} manifest
 * @returns {ValidationResult}
 */
export function validateCampaign(manifest) {
  /** @type {Issue[]} */ const errors = [];
  /** @type {Issue[]} */ const warnings = [];

  if (!isObj(manifest)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'manifest must be an object' }],
      warnings,
      value: null,
    };
  }

  if (manifest.schemaVersion !== 1) {
    errors.push({
      path: 'schemaVersion',
      message: `expected 1, got ${JSON.stringify(manifest.schemaVersion)}`,
    });
  }

  const value = {
    schemaVersion: 1,
    brand: checkBrand(manifest.brand, errors, warnings),
    items: checkItems(manifest.items, errors),
    hazard: checkHazard(manifest.hazard, errors),
    rules: checkRules(manifest.rules, errors, warnings),
    rewards: checkRewards(manifest.rewards, errors, warnings),
    campaign: checkCampaign(manifest.campaign, errors, warnings),
    legal: isObj(manifest.legal) ? manifest.legal : {},
  };

  return { ok: errors.length === 0, errors, warnings, value };
}

/** Human-readable report, used by the CI check and the console warning. */
export function formatIssues({ errors, warnings }) {
  const lines = [];
  for (const e of errors) lines.push(`ERROR  ${e.path || '(root)'}: ${e.message}`);
  for (const w of warnings) lines.push(`WARN   ${w.path || '(root)'}: ${w.message}`);
  return lines.join('\n');
}
