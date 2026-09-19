import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCampaign, formatIssues } from '../../src/campaign/schema.js';
import { toEngineShape, isCampaignLive } from '../../src/campaign/loader.js';

const REAL = JSON.parse(readFileSync('campaigns/mcdonalds.json', 'utf8'));

/** A minimal manifest that passes, for targeted mutation. */
const minimal = () => ({
  schemaVersion: 1,
  brand: { id: 'test-co', name: 'Test Co', gameName: 'Test Rush' },
  rules: { roundSeconds: 30, lives: 2 },
  items: [{ id: 'a', label: 'A', img: 'a.png', points: 100, radius: 40 }],
  hazard: { id: 'bad', img: 'bad.png', radius: 40 },
  rewards: { pointsThreshold: 4000, prizes: [{ key: 'p', label: 'Prize', weight: 100 }] },
});

describe('the shipped McDonald’s manifest', () => {
  it('is valid with no errors', () => {
    const r = validateCampaign(REAL);
    expect(formatIssues(r)).toBe('');
    expect(r.ok).toBe(true);
  });

  it('matches the values the engine ships with', () => {
    // Guards drift between engine/config.js and the manifest — the exact class
    // of bug that made RAMP_TIME wrong for six days.
    const shaped = toEngineShape(validateCampaign(REAL).value);
    expect(shaped.ROUND_TIME).toBe(30);
    expect(shaped.START_LIVES).toBe(2);
    expect(shaped.WHEEL.pointsThreshold).toBe(4000);
    expect(shaped.FOODS).toHaveLength(7);
    expect(shaped.FOODS.filter((f) => f.hero)).toHaveLength(1);
    expect(shaped.WHEEL.prizes).toHaveLength(10);
  });

  it('declares both supported locales', () => {
    expect(validateCampaign(REAL).value.brand.locales).toEqual(['en', 'ar']);
  });
});

describe('fails loudly on anything that affects money or fairness', () => {
  const rejects = (mutate, pathFragment) => {
    const m = minimal();
    mutate(m);
    const r = validateCampaign(m);
    expect(r.ok, `expected rejection for ${pathFragment}`).toBe(false);
    expect(r.errors.some((e) => e.path.includes(pathFragment))).toBe(true);
  };

  it('rejects a missing points threshold', () => {
    rejects((m) => delete m.rewards.pointsThreshold, 'pointsThreshold');
  });

  it('rejects a negative points threshold', () => {
    rejects((m) => (m.rewards.pointsThreshold = -1), 'pointsThreshold');
  });

  it('rejects a non-integer points threshold', () => {
    rejects((m) => (m.rewards.pointsThreshold = 40.5), 'pointsThreshold');
  });

  it('rejects an empty prize list', () => {
    rejects((m) => (m.rewards.prizes = []), 'prizes');
  });

  it('rejects a prize with no label — staff would have nothing to hand over', () => {
    rejects((m) => delete m.rewards.prizes[0].label, 'label');
  });

  it('rejects a zero or negative prize weight', () => {
    rejects((m) => (m.rewards.prizes[0].weight = 0), 'weight');
  });

  it('rejects duplicate prize keys', () => {
    rejects((m) => m.rewards.prizes.push({ key: 'p', label: 'Other', weight: 5 }), 'key');
  });

  it('rejects an out-of-range round length', () => {
    rejects((m) => (m.rules.roundSeconds = 0), 'roundSeconds');
    rejects((m) => (m.rules.roundSeconds = 9999), 'roundSeconds');
  });

  it('rejects non-integer or absurd lives', () => {
    rejects((m) => (m.rules.lives = 1.5), 'lives');
    rejects((m) => (m.rules.lives = 0), 'lives');
  });

  it('rejects an item with no sprite or bad points', () => {
    rejects((m) => delete m.items[0].img, 'img');
    rejects((m) => (m.items[0].points = 0), 'points');
  });

  it('rejects duplicate item ids', () => {
    rejects(
      (m) => m.items.push({ id: 'a', label: 'A2', img: 'b.png', points: 10, radius: 10 }),
      'id',
    );
  });

  it('rejects more than one hero item', () => {
    rejects((m) => {
      m.items[0].hero = true;
      m.items.push({ id: 'b', label: 'B', img: 'b.png', points: 10, radius: 10, hero: true });
    }, 'items');
  });

  it('rejects a missing hazard — the game needs something to avoid', () => {
    rejects((m) => delete m.hazard, 'hazard');
  });

  it('rejects a campaign that ends before it starts', () => {
    rejects((m) => {
      m.campaign = { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-08-01T00:00:00Z' };
    }, 'endsAt');
  });

  it('rejects an unknown schema version rather than guessing', () => {
    rejects((m) => (m.schemaVersion = 2), 'schemaVersion');
  });

  it('rejects a brand id that is not safe for storage keys and URLs', () => {
    rejects((m) => (m.brand.id = 'Not Safe!'), 'brand.id');
  });

  it('rejects junk instead of throwing', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      const r = validateCampaign(junk);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('falls back quietly on cosmetics', () => {
  it('substitutes a safe colour for an invalid hex and warns', () => {
    const m = minimal();
    m.brand.colors = { primary: 'not-a-colour' };
    const r = validateCampaign(m);
    // Refusing to boot a restaurant's game over a hex code would be the wrong
    // trade, so this is a warning with a default — not an error.
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.path.includes('colors.primary'))).toBe(true);
    expect(r.value.brand.colors.primary).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('defaults missing colours without complaint about the rest', () => {
    const m = minimal();
    const r = validateCampaign(m);
    expect(r.ok).toBe(true);
    expect(r.value.brand.colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('defaults locales to English and warns', () => {
    const r = validateCampaign(minimal());
    expect(r.value.brand.locales).toEqual(['en']);
    expect(r.warnings.some((w) => w.path === 'brand.locales')).toBe(true);
  });

  it('drops unsupported locales but keeps the supported ones', () => {
    const m = minimal();
    m.brand.locales = ['en', 'fr', 'ar'];
    const r = validateCampaign(m);
    expect(r.ok).toBe(true);
    expect(r.value.brand.locales).toEqual(['en', 'ar']);
  });

  it('warns when weights nearly sum to 100 — almost always a typo', () => {
    const m = minimal();
    m.rewards.prizes = [
      { key: 'a', label: 'A', weight: 60 },
      { key: 'b', label: 'B', weight: 35 },
    ];
    const r = validateCampaign(m);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('95'))).toBe(true);
  });

  it('does not warn for weights that are clearly relative, not percentages', () => {
    const m = minimal();
    m.rewards.prizes = [
      { key: 'a', label: 'A', weight: 3 },
      { key: 'b', label: 'B', weight: 1 },
    ];
    const r = validateCampaign(m);
    expect(r.warnings.some((w) => w.path === 'rewards.prizes')).toBe(false);
  });

  it('treats a missing campaign window as always-on', () => {
    const r = validateCampaign(minimal());
    expect(r.ok).toBe(true);
    expect(isCampaignLive(r.value.campaign)).toBe(true);
  });
});

describe('isCampaignLive', () => {
  const win = { startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-08-31T00:00:00Z' };

  it('is live inside the window', () => {
    expect(isCampaignLive(win, new Date('2026-08-15T12:00:00Z'))).toBe(true);
  });

  it('is not live before or after', () => {
    expect(isCampaignLive(win, new Date('2026-07-31T23:59:00Z'))).toBe(false);
    expect(isCampaignLive(win, new Date('2026-09-01T00:00:01Z'))).toBe(false);
  });

  it('treats null bounds as open-ended', () => {
    expect(isCampaignLive({ startsAt: null, endsAt: null }, new Date())).toBe(true);
    expect(isCampaignLive({ startsAt: '2026-01-01T00:00:00Z' }, new Date())).toBe(true);
  });
});

describe('toEngineShape', () => {
  it('produces the field names the engine already reads', () => {
    const shaped = toEngineShape(validateCampaign(minimal()).value);
    expect(Object.keys(shaped).sort()).toEqual(
      ['BOMB', 'BRAND', 'FOODS', 'ROUND_TIME', 'START_LIVES', 'WHEEL'].sort(),
    );
    expect(shaped.FOODS[0]).toMatchObject({ id: 'a', label: 'A', points: 100, radius: 40 });
  });

  it('supplies a glyph fallback for a sprite that fails to load', () => {
    const shaped = toEngineShape(validateCampaign(minimal()).value);
    expect(typeof shaped.FOODS[0].glyph).toBe('string');
    expect(shaped.FOODS[0].glyph.length).toBeGreaterThan(0);
  });

  it('honours a feature flag that disables the wheel', () => {
    const m = minimal();
    m.brand.features = { wheel: false };
    const shaped = toEngineShape(validateCampaign(m).value);
    expect(shaped.WHEEL.enabled).toBe(false);
  });
});

describe('rewards.gate (migration 0007)', () => {
  it('defaults to order points when absent', () => {
    const shaped = toEngineShape(validateCampaign(minimal()).value);
    expect(shaped.WHEEL.gate).toBe('order_points');
  });

  it('carries a score gate through to the engine', () => {
    const m = minimal();
    m.rewards.gate = 'score';
    const r = validateCampaign(m);
    expect(r.ok).toBe(true);
    expect(toEngineShape(r.value).WHEEL.gate).toBe('score');
  });

  it('rejects an unknown gate rather than guessing', () => {
    const m = minimal();
    m.rewards.gate = 'vibes';
    const r = validateCampaign(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'rewards.gate')).toBe(true);
  });
});
