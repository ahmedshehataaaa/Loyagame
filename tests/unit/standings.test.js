import { describe, it, expect } from 'vitest';
import { normalizeRow, rankStandings, tierFor, TIERS } from '../../src/game/standings.js';
import { RIVALS } from '../../src/data/catalog.js';

/* The board used to print whatever the row held straight into the DOM, so a
   null name or an unresolved score reached the player as the literal text
   "null" / "NaN". These prove the boundary, not the rendering. */

describe('normalizeRow — names', () => {
  it('keeps a real name', () => {
    expect(normalizeRow({ name: 'Ahmed', score: 10 }).name).toBe('Ahmed');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an object', {}],
  ])('falls back to a label when the name is %s', (_label, value) => {
    const row = normalizeRow({ name: value, score: 10 });
    expect(row.name).toBe('Player');
    expect(String(row.name)).not.toMatch(/null|undefined|NaN|\[object/);
  });

  it('trims surrounding whitespace rather than rendering it', () => {
    expect(normalizeRow({ name: '  Nour  ' }).name).toBe('Nour');
  });

  it('survives a missing row entirely', () => {
    expect(normalizeRow(undefined).name).toBe('Player');
    expect(normalizeRow(null).score).toBe(0);
  });
});

describe('normalizeRow — scores', () => {
  it('keeps a real score', () => {
    expect(normalizeRow({ name: 'Omar', score: 942000 }).score).toBe(942000);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['a non-numeric string', 'abc'],
    ['Infinity', Infinity],
    ['negative', -50],
  ])('floors the score to 0 when it is %s', (_label, value) => {
    const row = normalizeRow({ name: 'Omar', score: value });
    expect(row.score).toBe(0);
    expect(Number.isFinite(row.score)).toBe(true);
  });

  it('never produces a score that formats as NaN', () => {
    for (const bad of [null, undefined, NaN, 'x', {}, []]) {
      expect(normalizeRow({ score: bad }).score.toLocaleString()).not.toContain('NaN');
    }
  });
});

describe('rankStandings', () => {
  it('ranks strictly sequentially with no duplicates or gaps', () => {
    const ranked = rankStandings([
      { name: 'A', score: 10 },
      { name: 'B', score: 30 },
      { name: 'C', score: 20 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });

  it('breaks ties on name so the order is stable', () => {
    const ranked = rankStandings([
      { name: 'Zara', score: 100 },
      { name: 'Adam', score: 100 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['Adam', 'Zara']);
  });

  it('sorts rows with broken scores to the bottom instead of throwing', () => {
    const ranked = rankStandings([
      { name: 'Good', score: 500 },
      { name: 'Broken', score: null },
    ]);
    expect(ranked[0].name).toBe('Good');
    expect(ranked[1]).toMatchObject({ name: 'Broken', score: 0, rank: 2 });
  });

  it('returns an empty list for a non-array', () => {
    for (const bad of [null, undefined, 'nope', 42, {}]) {
      expect(rankStandings(bad)).toEqual([]);
    }
  });

  it('marks only the player row', () => {
    const ranked = rankStandings([
      { name: 'Ahmed', score: 10 },
      { name: 'Salma', score: 20, you: true },
    ]);
    expect(ranked.filter((r) => r.you)).toHaveLength(1);
    expect(ranked.find((r) => r.you).name).toBe('Salma');
  });
});

describe('tierFor', () => {
  it('names each podium position from the reference copy', () => {
    expect(tierFor(1)).toBe('Ultimate Master');
    expect(tierFor(2)).toBe('Diamond Rank');
    expect(tierFor(3)).toBe('Platinum Rank');
  });

  it('falls back for anything past the named tiers', () => {
    for (const rank of [TIERS.length + 1, 50, 0, -1]) {
      expect(tierFor(rank)).toBe('Ranked Player');
    }
  });
});

describe('seeded rivals', () => {
  const APPROVED = ['Ahmed', 'Meera', 'Jana', 'Youssef', 'Laila', 'Omar', 'Nour'];

  it('uses only approved real first names', () => {
    expect(RIVALS.map((r) => r.name)).toEqual(APPROVED);
  });

  it('carries no gamertag-shaped names', () => {
    for (const { name } of RIVALS) {
      expect(name, `"${name}" contains digits or an underscore`).toMatch(/^[A-Za-z]+$/);
      expect(name, `"${name}" reads as a food pun`).not.toMatch(
        /king|fanatic|stacker|slicer|ninja|pounder|sauce|shake|mc/i,
      );
    }
  });

  it('every seeded row survives normalisation unchanged', () => {
    for (const rival of RIVALS) {
      const row = normalizeRow(rival);
      expect(row.name).toBe(rival.name);
      expect(row.score).toBe(rival.score);
    }
  });
});
