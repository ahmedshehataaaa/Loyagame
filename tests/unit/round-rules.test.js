import { describe, it, expect } from 'vitest';
import {
  OUTCOME,
  resolveOutcome,
  isWin,
  applyHazardHit,
  isPlausibleRun,
} from '../../src/game/round-rules.js';

describe('resolveOutcome — the two-bomb loss rule', () => {
  it('surviving the full round wins', () => {
    expect(resolveOutcome({ livesRemaining: 2, timeLeftSec: 0 })).toBe(OUTCOME.SURVIVED);
    expect(resolveOutcome({ livesRemaining: 1, timeLeftSec: 0 })).toBe(OUTCOME.SURVIVED);
  });

  it('running out of lives loses, even mid-round', () => {
    expect(resolveOutcome({ livesRemaining: 0, timeLeftSec: 12 })).toBe(OUTCOME.ELIMINATED);
  });

  it('the hazard wins a tie when lives and clock hit zero on the same frame', () => {
    expect(resolveOutcome({ livesRemaining: 0, timeLeftSec: 0 })).toBe(OUTCOME.ELIMINATED);
  });

  it('a high score does not rescue an eliminated run', () => {
    // The exact bug this replaces: "won" used to be `score >= 15000`, so dying
    // to bombs at 28s with a big score reported a win.
    expect(isWin(resolveOutcome({ livesRemaining: 0, timeLeftSec: 2 }))).toBe(false);
  });

  it('quitting mid-round with lives intact is not a survival', () => {
    expect(resolveOutcome({ livesRemaining: 2, timeLeftSec: 18 })).toBe(OUTCOME.ELIMINATED);
  });
});

describe('applyHazardHit — exactly two bombs ends it', () => {
  it('one hit from the 2-life default does not eliminate', () => {
    const first = applyHazardHit(2);
    expect(first).toEqual({ livesRemaining: 1, eliminated: false });
  });

  it('the second hit eliminates', () => {
    const second = applyHazardHit(applyHazardHit(2).livesRemaining);
    expect(second).toEqual({ livesRemaining: 0, eliminated: true });
  });

  it('never goes negative', () => {
    expect(applyHazardHit(0)).toEqual({ livesRemaining: 0, eliminated: true });
  });

  it('a full 2-life round survives one bomb and loses to two', () => {
    let lives = 2;
    ({ livesRemaining: lives } = applyHazardHit(lives));
    expect(isWin(resolveOutcome({ livesRemaining: lives, timeLeftSec: 0 }))).toBe(true);
    ({ livesRemaining: lives } = applyHazardHit(lives));
    expect(isWin(resolveOutcome({ livesRemaining: lives, timeLeftSec: 0 }))).toBe(false);
  });
});

describe('isPlausibleRun', () => {
  const base = { roundSec: 30, durationMs: 30000, score: 40000 };

  it('accepts an ordinary round', () => {
    expect(isPlausibleRun(base)).toBe(true);
  });

  it('rejects an impossible score for the elapsed time', () => {
    expect(isPlausibleRun({ ...base, score: 5_000_000 })).toBe(false);
  });

  it('rejects a duration far beyond the round length', () => {
    expect(isPlausibleRun({ ...base, durationMs: 600_000 })).toBe(false);
  });

  it('rejects negative and non-finite values', () => {
    expect(isPlausibleRun({ ...base, durationMs: -1 })).toBe(false);
    expect(isPlausibleRun({ ...base, score: NaN })).toBe(false);
    expect(isPlausibleRun({ ...base, durationMs: Infinity })).toBe(false);
  });
});
