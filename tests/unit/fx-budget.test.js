import { describe, it, expect } from 'vitest';
import { capPush, burstSize, shakeAmount, shouldTick } from '../../src/game/fx-budget.js';

describe('capPush — bounded effect lists', () => {
  it('behaves like push below the cap', () => {
    const list = [];
    capPush(list, 'a', 3);
    capPush(list, 'b', 3);
    expect(list).toEqual(['a', 'b']);
  });

  it('never exceeds the cap', () => {
    // The regression this locks in: particles/popups/halves grew unbounded for
    // a whole round (audit P7), costing frame time exactly when the game was
    // busiest and burying the items being aimed at.
    const list = [];
    for (let i = 0; i < 5000; i++) capPush(list, i, 220);
    expect(list.length).toBe(220);
  });

  it('drops the OLDEST, keeping the newest', () => {
    // Dropping the newest would mean the slice the player just made produced
    // no feedback — the one effect that must never be skipped.
    const list = [];
    for (let i = 0; i < 6; i++) capPush(list, i, 3);
    expect(list).toEqual([3, 4, 5]);
  });

  it('treats a zero cap as "emit nothing" rather than growing', () => {
    const list = [];
    capPush(list, 'a', 0);
    expect(list).toEqual([]);
  });

  it('tolerates a fractional cap', () => {
    const list = [];
    for (let i = 0; i < 10; i++) capPush(list, i, 3.7);
    expect(list.length).toBe(3);
  });
});

describe('burstSize — particle budget', () => {
  const max = 200;

  it('grants the full burst when there is headroom', () => {
    expect(burstSize(20, { inUse: 0, max })).toBe(20);
  });

  it('shrinks the burst as the pool fills', () => {
    expect(burstSize(20, { inUse: 190, max })).toBe(10);
  });

  it('still emits a legible minimum once the pool is full', () => {
    // A full pool must not mean the newest hit is invisible.
    const n = burstSize(20, { inUse: max, max });
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('never exceeds what was requested, even with huge headroom', () => {
    expect(burstSize(6, { inUse: 0, max: 10000 })).toBe(6);
  });

  it('collapses to a token burst under reduced motion, but never to zero', () => {
    // Reduced motion should strip the spray, not the confirmation that a hit
    // registered — going silent would make the game feel broken.
    const n = burstSize(20, { inUse: 0, max, reduced: true, reducedScale: 0.15 });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(20);
  });

  it('emits at least one under reduced motion even for a tiny burst', () => {
    expect(burstSize(2, { inUse: 0, max, reduced: true, reducedScale: 0.01 })).toBe(1);
  });

  it('emits nothing for a zero request', () => {
    expect(burstSize(0, { inUse: 0, max })).toBe(0);
    expect(burstSize(0, { inUse: 0, max, reduced: true })).toBe(0);
  });
});

describe('shakeAmount', () => {
  it('clamps to the ceiling', () => {
    // The engine used a raw 26 on every bomb — heavy enough to make the field
    // hard to re-aim through at the exact moment the player must.
    expect(shakeAmount(26, { max: 14 })).toBe(14);
  });

  it('passes through anything under the ceiling', () => {
    expect(shakeAmount(5, { max: 14 })).toBe(5);
  });

  it('is zero under reduced motion by default', () => {
    expect(shakeAmount(26, { max: 14, reduced: true })).toBe(0);
  });

  it('honours a non-zero reduced scale if a build wants one', () => {
    expect(shakeAmount(10, { max: 14, reduced: true, reducedScale: 0.2 })).toBeCloseTo(2, 6);
  });

  it('never goes negative', () => {
    expect(shakeAmount(-5, { max: 14 })).toBe(0);
  });
});

describe('shouldTick — countdown urgency', () => {
  it('fires exactly once per second in the final stretch', () => {
    // Frame-rate independence is the whole point: a naive per-frame check
    // ticks 60x a second at 60fps and once at 1fps.
    let ticks = 0;
    let t = 10;
    const dt = 1 / 60;
    while (t > 0) {
      const prev = t;
      t = Math.max(0, t - dt);
      if (shouldTick(prev, t, 5)) ticks++;
    }
    // Seconds 5,4,3,2,1 boundaries crossed.
    expect(ticks).toBe(5);
  });

  it('gives the same count at a very low frame rate', () => {
    let ticks = 0;
    let t = 10;
    const dt = 0.5; // 2fps
    while (t > 0) {
      const prev = t;
      t = Math.max(0, t - dt);
      if (shouldTick(prev, t, 5)) ticks++;
    }
    expect(ticks).toBe(5);
  });

  it('stays silent outside the final stretch', () => {
    expect(shouldTick(20.01, 19.99, 5)).toBe(false);
  });

  it('does not tick once the clock has run out', () => {
    expect(shouldTick(0.01, 0, 5)).toBe(false);
    expect(shouldTick(0, 0, 5)).toBe(false);
  });

  it('does not tick when no second boundary was crossed', () => {
    expect(shouldTick(3.9, 3.8, 5)).toBe(false);
  });
});
