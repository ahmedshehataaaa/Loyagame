import { describe, it, expect } from 'vitest';
import {
  visibleVirtualRange,
  safeSpawnBounds,
  isFullyVisible,
  safeApexBand,
} from '../../src/game/field.js';
import { planWave } from '../../src/game/wave-planner.js';
import { seededRng } from '../../src/game/rng.js';

const FIELD = { fieldW: 720, fieldH: 1280 };
/** The supported matrix, plus a wide desktop window. */
const VIEWPORTS = [
  [320, 568],
  [360, 800],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
  [1280, 720],
];
const MAX_RADIUS = 56; // largest sprite in the McDonald's roster

describe('visibleVirtualRange — what the cover scale actually shows', () => {
  it('shows the whole field when the aspect ratios match', () => {
    const v = visibleVirtualRange({ viewportW: 360, viewportH: 640, ...FIELD });
    expect(v.minXFrac).toBeCloseTo(0, 3);
    expect(v.maxXFrac).toBeCloseTo(1, 3);
  });

  it('crops the SIDES on a viewport taller than the field', () => {
    /* This is the whole bug in one assertion. COVER scaling means a tall phone
       drives the scale by height, so the field is wider than the screen and a
       strip down each side is off screen. Spawn margins were fixed fractions of
       the virtual width and knew nothing about it. */
    const v = visibleVirtualRange({ viewportW: 390, viewportH: 844, ...FIELD });
    expect(v.minXFrac).toBeGreaterThan(0);
    expect(v.maxXFrac).toBeLessThan(1);
    // ~8.9% of the field is cropped from each side at this viewport.
    expect(v.minXFrac).toBeCloseTo(0.089, 2);
    expect(v.maxXFrac).toBeCloseTo(0.911, 2);
  });

  it('crops the TOP and BOTTOM on a viewport wider than the field', () => {
    const v = visibleVirtualRange({ viewportW: 1280, viewportH: 720, ...FIELD });
    expect(v.minXFrac).toBeCloseTo(0, 3);
    expect(v.minYFrac).toBeGreaterThan(0);
    expect(v.maxYFrac).toBeLessThan(1);
  });

  it('never reports a range outside the field', () => {
    for (const [w, h] of VIEWPORTS) {
      const v = visibleVirtualRange({ viewportW: w, viewportH: h, ...FIELD });
      expect(v.minXFrac).toBeGreaterThanOrEqual(0);
      expect(v.maxXFrac).toBeLessThanOrEqual(1);
      expect(v.maxXFrac).toBeGreaterThan(v.minXFrac);
    }
  });

  it('survives a zero-size canvas instead of producing NaN', () => {
    // Happens during teardown; NaN bounds would poison every later spawn.
    const v = visibleVirtualRange({ viewportW: 0, viewportH: 0, ...FIELD });
    expect(Number.isFinite(v.minXFrac)).toBe(true);
    expect(Number.isFinite(v.maxXFrac)).toBe(true);
  });
});

describe('safeSpawnBounds', () => {
  it('insets by the sprite radius so a whole item stays visible', () => {
    const radiusFrac = MAX_RADIUS / FIELD.fieldW;
    const b = safeSpawnBounds({ minXFrac: 0, maxXFrac: 1, radiusFrac, breathFrac: 0.02 });
    expect(b.minFrac).toBeGreaterThanOrEqual(radiusFrac);
    expect(b.maxFrac).toBeLessThanOrEqual(1 - radiusFrac);
  });

  it('degrades to a centred band rather than inverting on a very narrow view', () => {
    // An inverted range would produce NaN corridors, which is worse than a
    // tighter play area.
    const b = safeSpawnBounds({ minXFrac: 0.48, maxXFrac: 0.52, radiusFrac: 0.3 });
    expect(b.maxFrac).toBeGreaterThan(b.minFrac);
    expect(Number.isFinite(b.minFrac)).toBe(true);
  });
});

describe('no item escapes the visible field, on any supported viewport', () => {
  /* The regression this exists for: measured before the fix, 32-40px of every
     edge-most item was outside the visible area on 360x800, 390x844, 412x915
     and 430x932 — four of the six supported viewports. */
  it.each(VIEWPORTS)('%ix%i keeps every spawn fully on screen', (w, h) => {
    const vis = visibleVirtualRange({ viewportW: w, viewportH: h, ...FIELD });
    const radiusFrac = MAX_RADIUS / FIELD.fieldW;
    const bounds = safeSpawnBounds({
      minXFrac: vis.minXFrac,
      maxXFrac: vis.maxXFrac,
      radiusFrac,
      breathFrac: 0.02,
    });

    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rng = seededRng(seed);
      for (const difficulty of [0, 0.5, 1]) {
        const wave = planWave({ difficulty, rng, tuning: { bounds } });
        for (const s of wave.spawns) {
          checked += 2;
          expect(
            isFullyVisible(s.startXFrac, radiusFrac, vis),
            `${w}x${h} startX ${s.startXFrac.toFixed(3)} outside [${vis.minXFrac.toFixed(3)}, ${vis.maxXFrac.toFixed(3)}]`,
          ).toBe(true);
          expect(
            isFullyVisible(s.targetXFrac, radiusFrac, vis),
            `${w}x${h} targetX ${s.targetXFrac.toFixed(3)} outside visible range`,
          ).toBe(true);
        }
      }
    }
    // Guard against a vacuous pass.
    expect(checked).toBeGreaterThan(200);
  });

  it('would FAIL with the old flat margin — proving the test has teeth', () => {
    // The pre-fix behaviour: a fixed 0.1 margin with no knowledge of the crop.
    const vis = visibleVirtualRange({ viewportW: 390, viewportH: 844, ...FIELD });
    const radiusFrac = MAX_RADIUS / FIELD.fieldW;
    let anyOutside = false;
    for (let seed = 1; seed <= 60 && !anyOutside; seed++) {
      const wave = planWave({ difficulty: 1, rng: seededRng(seed), tuning: { marginFrac: 0.1 } });
      for (const s of wave.spawns) {
        if (!isFullyVisible(s.startXFrac, radiusFrac, vis)) anyOutside = true;
      }
    }
    expect(anyOutside).toBe(true);
  });
});

/* ============================================================
   The top edge — the same crop on the other axis.

   `1 - apexFrac` is the sprite's topmost point as a fraction of the field
   (the radius cancels; see field.js). Every assertion below is written in
   those terms so it states the player-visible property directly: the top of
   the sprite must not cross the top of the visible strip.
   ============================================================ */
describe('safeApexBand — items must not escape the top edge', () => {
  const CONFIGURED = { apexMin: 0.58, apexMax: 0.74 };

  it('leaves the configured band alone on every portrait phone', () => {
    for (const [w, h] of VIEWPORTS.filter(([vw, vh]) => vh > vw)) {
      const vis = visibleVirtualRange({ viewportW: w, viewportH: h, ...FIELD });
      const band = safeApexBand({ minYFrac: vis.minYFrac, ...CONFIGURED });
      expect(band).toEqual(CONFIGURED);
    }
  });

  it('clamps the band on a wide desktop window, where the field overflows', () => {
    const vis = visibleVirtualRange({ viewportW: 1512, viewportH: 900, ...FIELD });
    expect(vis.minYFrac).toBeGreaterThan(0); // the top really is cropped
    const band = safeApexBand({ minYFrac: vis.minYFrac, ...CONFIGURED });
    expect(band.apexMax).toBeLessThan(CONFIGURED.apexMax);
  });

  it('keeps every sprite top inside the visible strip, at every viewport', () => {
    // Including landscape and wide-desktop shapes the matrix does not cover.
    const SHAPES = [...VIEWPORTS, [1512, 900], [1920, 1080], [1024, 768], [800, 600]];
    for (const [w, h] of SHAPES) {
      const vis = visibleVirtualRange({ viewportW: w, viewportH: h, ...FIELD });
      const band = safeApexBand({ minYFrac: vis.minYFrac, ...CONFIGURED });
      for (let seed = 1; seed <= 40; seed++) {
        const wave = planWave({
          difficulty: 1,
          rng: seededRng(seed),
          tuning: { apexMin: band.apexMin, apexMax: band.apexMax },
        });
        for (const s of wave.spawns) {
          const topFrac = 1 - s.apexFrac;
          expect(topFrac).toBeGreaterThanOrEqual(vis.minYFrac - 1e-9);
        }
      }
    }
  });

  it('would FAIL with the unclamped config — proving the test has teeth', () => {
    const vis = visibleVirtualRange({ viewportW: 1512, viewportH: 900, ...FIELD });
    let anyAboveTop = false;
    for (let seed = 1; seed <= 40 && !anyAboveTop; seed++) {
      const wave = planWave({ difficulty: 1, rng: seededRng(seed), tuning: CONFIGURED });
      for (const s of wave.spawns) {
        if (1 - s.apexFrac < vis.minYFrac) anyAboveTop = true;
      }
    }
    expect(anyAboveTop).toBe(true);
  });

  it('still rises far enough to be sliceable when the strip is very short', () => {
    // A pathological window: almost all of the field's height is cropped.
    const band = safeApexBand({ minYFrac: 0.9, ...CONFIGURED });
    expect(band.apexMax).toBeGreaterThan(0);
    expect(band.apexMin).toBeLessThanOrEqual(band.apexMax);
  });

  it('never emits an inverted or NaN band', () => {
    for (const minYFrac of [0, 0.1, 0.33, 0.5, 0.75, 0.95, 1]) {
      const band = safeApexBand({ minYFrac, ...CONFIGURED });
      expect(Number.isFinite(band.apexMin)).toBe(true);
      expect(Number.isFinite(band.apexMax)).toBe(true);
      expect(band.apexMin).toBeLessThanOrEqual(band.apexMax);
    }
  });
});
