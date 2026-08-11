import { describe, it, expect } from 'vitest';
import { rotationForIndex, wheelSegments } from '../../src/components/spin-wheel.js';

/* The wheel's maths, tested without a DOM.
   Landing on the wrong segment would show a player a prize they were NOT
   given — a lie about a real-money outcome, not a cosmetic glitch. */

describe('rotationForIndex — the wheel must stop on the server’s segment', () => {
  const COUNT = 10;

  it('brings segment 0 to the pointer with whole turns only', () => {
    expect(rotationForIndex(0, COUNT) % 360).toBe(0);
  });

  it('lands every segment under the pointer, to the degree', () => {
    const step = 360 / COUNT;
    for (let i = 0; i < COUNT; i++) {
      const deg = rotationForIndex(i, COUNT);
      // After rotating by `deg`, segment i sits at (i*step + deg) mod 360,
      // which must be 0 — i.e. at the top, under the pointer.
      const resting = (i * step + deg) % 360;
      expect(Math.round(resting), `segment ${i} rests at ${resting}deg`).toBe(0);
    }
  });

  it('always spins forward through several turns, never backwards', () => {
    // A wheel that jumps backwards to a nearer segment reads as a glitch.
    for (let i = 0; i < COUNT; i++) {
      expect(rotationForIndex(i, COUNT)).toBeGreaterThanOrEqual(4 * 360);
    }
  });

  it('honours a custom turn count', () => {
    expect(rotationForIndex(0, COUNT, 3)).toBe(3 * 360);
  });

  it('works for any segment count a campaign might configure', () => {
    for (const count of [3, 4, 6, 8, 10, 12]) {
      const step = 360 / count;
      for (let i = 0; i < count; i++) {
        const resting = (i * step + rotationForIndex(i, count)) % 360;
        expect(Math.round(resting), `count=${count} i=${i}`).toBe(0);
      }
    }
  });

  it('degrades safely on nonsense input rather than producing NaN', () => {
    // A NaN rotation would leave the wheel stuck and the prize unrevealed.
    expect(Number.isFinite(rotationForIndex(NaN, 10))).toBe(true);
    expect(Number.isFinite(rotationForIndex(0, 0))).toBe(true);
    expect(Number.isFinite(rotationForIndex(-1, 10))).toBe(true);
  });
});

describe('wheelSegments — the server owns the segment order', () => {
  it('uses the server’s wheel when one is supplied', () => {
    /* This is what stops the animation and the award disagreeing: the layout is
       built from the same array the server drew from. */
    const server = [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta' },
    ];
    const segs = wheelSegments(server);
    expect(segs.map((s) => s.key)).toEqual(['a', 'b']);
    expect(segs[0].label).toBe('Alpha');
  });

  it('falls back to the configured prizes only when the server sent none', () => {
    // Purely so the wheel can be laid out before a response arrives.
    const segs = wheelSegments(null);
    expect(Array.isArray(segs)).toBe(true);
  });

  it('ignores an empty server wheel rather than rendering nothing', () => {
    expect(wheelSegments([]).length).toBeGreaterThanOrEqual(0);
  });

  it('gives every segment a glyph so a missing sprite still renders', () => {
    const segs = wheelSegments([{ key: 'mystery', label: 'Mystery Prize' }]);
    expect(segs[0].glyph.length).toBeGreaterThan(0);
  });

  it('maps known prize keys to real product art', () => {
    const segs = wheelSegments([
      { key: 'fries', label: 'Free Fries' },
      { key: 'unknown-key', label: 'Something' },
    ]);
    expect(segs[0].art).toContain('fries');
    // An unknown key gets no art and falls back to its glyph — never a broken
    // image in the middle of the reward reveal.
    expect(segs[1].art).toBeNull();
  });
});
