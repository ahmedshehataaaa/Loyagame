import { describe, it, expect } from 'vitest';
import { planWave, difficultyAt } from '../../src/game/wave-planner.js';
import { corridorGap } from '../../src/game/collision.js';
import { seededRng } from '../../src/game/rng.js';

const CLEARANCE = 0.18;
const tuning = { bombClearanceFrac: CLEARANCE, maxBombsPerWave: 1 };

/** Every wave across a wide sweep of seeds and difficulties. */
function* allWaves({ frenzy = false, waveTuning = tuning } = {}) {
  for (let seed = 1; seed <= 400; seed++) {
    const rng = seededRng(seed);
    for (const difficulty of [0, 0.25, 0.5, 0.75, 1]) {
      yield planWave({ difficulty, rng, frenzy, tuning: waveTuning });
    }
  }
}

describe('planWave — hazard fairness', () => {
  it('never places a hazard within the clearance of a food in the same wave', () => {
    let checked = 0;
    for (const wave of allWaves()) {
      const bombs = wave.spawns.filter((s) => s.kind === 'bomb');
      const others = wave.spawns.filter((s) => s.kind !== 'bomb');
      for (const b of bombs) {
        for (const o of others) {
          const gap = corridorGap(b.startXFrac, b.targetXFrac, o.startXFrac, o.targetXFrac);
          expect(gap).toBeGreaterThanOrEqual(CLEARANCE);
          checked++;
        }
      }
    }
    // Guard against a vacuous pass: the sweep must actually produce pairings.
    expect(checked).toBeGreaterThan(100);
  });

  it('never exceeds maxBombsPerWave', () => {
    for (const wave of allWaves()) {
      expect(wave.spawns.filter((s) => s.kind === 'bomb').length).toBeLessThanOrEqual(1);
    }
  });

  it('emits no hazards at all during frenzy', () => {
    for (const wave of allWaves({ frenzy: true })) {
      expect(wave.spawns.some((s) => s.kind === 'bomb')).toBe(false);
    }
  });

  it('still produces hazards at high difficulty (the guarantee is not "no bombs")', () => {
    let bombs = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const wave = planWave({ difficulty: 1, rng: seededRng(seed), tuning });
      bombs += wave.spawns.filter((s) => s.kind === 'bomb').length;
    }
    expect(bombs).toBeGreaterThan(20);
  });
});

describe('planWave — field bounds', () => {
  it('keeps every launch and landing inside the margins', () => {
    const margin = 0.1;
    for (const wave of allWaves({ waveTuning: { ...tuning, marginFrac: margin } })) {
      for (const s of wave.spawns) {
        expect(s.startXFrac).toBeGreaterThanOrEqual(margin - 1e-9);
        expect(s.startXFrac).toBeLessThanOrEqual(1 - margin + 1e-9);
        expect(s.targetXFrac).toBeGreaterThanOrEqual(margin - 1e-9);
        expect(s.targetXFrac).toBeLessThanOrEqual(1 - margin + 1e-9);
      }
    }
  });

  it('keeps apex within the configured band', () => {
    for (const wave of allWaves()) {
      for (const s of wave.spawns) {
        expect(s.apexFrac).toBeGreaterThanOrEqual(0.58);
        expect(s.apexFrac).toBeLessThanOrEqual(0.74);
      }
    }
  });
});

describe('planWave — pacing', () => {
  it('spawns faster as difficulty rises', () => {
    const easy = planWave({ difficulty: 0, rng: seededRng(7), tuning }).intervalSec;
    const hard = planWave({ difficulty: 1, rng: seededRng(7), tuning }).intervalSec;
    expect(hard).toBeLessThan(easy);
  });

  it('spawns fastest during frenzy', () => {
    const normal = planWave({ difficulty: 0.5, rng: seededRng(3), tuning }).intervalSec;
    const frenzy = planWave({
      difficulty: 0.5,
      rng: seededRng(3),
      frenzy: true,
      tuning,
    }).intervalSec;
    expect(frenzy).toBeLessThan(normal);
  });

  it('always emits at least one item', () => {
    for (const wave of allWaves()) {
      expect(wave.spawns.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = planWave({ difficulty: 0.6, rng: seededRng(42), tuning });
    const b = planWave({ difficulty: 0.6, rng: seededRng(42), tuning });
    expect(a).toEqual(b);
  });
});

describe('difficultyAt', () => {
  it('reaches full difficulty before the round ends', () => {
    // The regression this locks in: RAMP_TIME was 50s inside a 30s round, so
    // difficulty peaked at ~0.6 and the tense finish never arrived.
    expect(difficultyAt(30, 30)).toBe(1);
    expect(difficultyAt(25.5, 30)).toBeCloseTo(1, 5);
  });

  it('starts gentle', () => {
    expect(difficultyAt(0, 30)).toBe(0);
    expect(difficultyAt(3, 30)).toBeLessThan(0.2);
  });

  it('rises monotonically', () => {
    let prev = -1;
    for (let t = 0; t <= 30; t += 0.5) {
      const d = difficultyAt(t, 30);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('is clamped to 0..1', () => {
    expect(difficultyAt(-5, 30)).toBe(0);
    expect(difficultyAt(999, 30)).toBe(1);
  });

  it('scales with round length rather than assuming 30s', () => {
    expect(difficultyAt(60, 60)).toBe(1);
    expect(difficultyAt(30, 60)).toBeCloseTo(difficultyAt(15, 30), 5);
  });
});
