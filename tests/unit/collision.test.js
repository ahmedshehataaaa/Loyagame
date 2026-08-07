import { describe, it, expect } from 'vitest';
import { segmentHitsCircle, distanceToSegment, corridorGap } from '../../src/game/collision.js';

describe('segmentHitsCircle', () => {
  it('hits a circle the segment passes through', () => {
    expect(segmentHitsCircle(0, 50, 200, 50, 100, 50, 30)).toBe(true);
  });

  it('misses a circle the segment passes wide of', () => {
    expect(segmentHitsCircle(0, 0, 200, 0, 100, 200, 30)).toBe(false);
  });

  it('does not tunnel through a circle on a fast swipe', () => {
    // A 900px swipe in one frame across a 50px item: a point test at either
    // endpoint would miss entirely, which is exactly the failure mode a
    // segment test exists to prevent.
    expect(segmentHitsCircle(-450, 400, 450, 400, 0, 400, 50)).toBe(true);
  });

  it('does not hit past the end of the segment', () => {
    // The item is on the swipe's line but beyond where the finger stopped.
    expect(segmentHitsCircle(0, 0, 100, 0, 400, 0, 30)).toBe(false);
  });

  it('treats tolerance > 1 as a more forgiving target', () => {
    // Just outside the true radius.
    const justOutside = () => segmentHitsCircle(0, 0, 200, 0, 100, 32, 30, 1);
    const forgiving = () => segmentHitsCircle(0, 0, 200, 0, 100, 32, 30, 1.08);
    expect(justOutside()).toBe(false);
    expect(forgiving()).toBe(true);
  });

  it('regression: tolerance below 1 shrinks the target below the sprite', () => {
    // Documents why the old hardcoded 0.85 felt unresponsive — a hit visually
    // on the sprite registered as a miss.
    expect(segmentHitsCircle(0, 0, 200, 0, 100, 27, 30, 0.85)).toBe(false);
    expect(segmentHitsCircle(0, 0, 200, 0, 100, 27, 30, 1)).toBe(true);
  });

  it('handles a zero-length segment as a point test', () => {
    expect(segmentHitsCircle(100, 100, 100, 100, 100, 100, 10)).toBe(true);
    expect(segmentHitsCircle(0, 0, 0, 0, 100, 100, 10)).toBe(false);
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the span', () => {
    expect(distanceToSegment(0, 0, 100, 0, 50, 25)).toBeCloseTo(25, 6);
  });

  it('clamps to the nearest endpoint outside the span', () => {
    expect(distanceToSegment(0, 0, 100, 0, 150, 0)).toBeCloseTo(50, 6);
    expect(distanceToSegment(0, 0, 100, 0, -30, 40)).toBeCloseTo(50, 6);
  });
});

describe('corridorGap', () => {
  it('is zero for overlapping corridors', () => {
    expect(corridorGap(0.2, 0.4, 0.3, 0.5)).toBe(0);
    expect(corridorGap(0.2, 0.8, 0.4, 0.5)).toBe(0);
  });

  it('measures the clear space between disjoint corridors', () => {
    expect(corridorGap(0.1, 0.2, 0.5, 0.6)).toBeCloseTo(0.3, 6);
    expect(corridorGap(0.5, 0.6, 0.1, 0.2)).toBeCloseTo(0.3, 6);
  });

  it('is zero for corridors that merely touch', () => {
    expect(corridorGap(0.1, 0.3, 0.3, 0.5)).toBe(0);
  });
});
