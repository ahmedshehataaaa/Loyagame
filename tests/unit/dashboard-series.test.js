import { describe, it, expect } from 'vitest';
import { fillDays, fillHours, cairoDay } from '../../dashboard/src/lib/series.js';
import { maskPhone, maskCode } from '../../dashboard/src/lib/format.js';

/* The admin endpoints GROUP BY, so quiet days and quiet hours come back
   ABSENT rather than zero. Handing those sparse rows straight to a chart is
   the bug these functions exist to prevent: a line drawn only through the
   days that had traffic slopes smoothly across a dead week and reads as
   steady play. */
describe('fillDays', () => {
  const NOW = Date.parse('2026-08-12T09:00:00Z');

  it('returns exactly one point per day in the window', () => {
    expect(fillDays([], 30, NOW)).toHaveLength(30);
    expect(fillDays([], 1, NOW)).toHaveLength(1);
  });

  it('fills absent days with a real zero rather than dropping them', () => {
    const filled = fillDays([{ day: cairoDay(new Date(NOW)), n: 5 }], 7, NOW);
    expect(filled).toHaveLength(7);
    expect(filled.at(-1)).toEqual({ day: cairoDay(new Date(NOW)), n: 5 });
    expect(filled.slice(0, 6).every((d) => d.n === 0)).toBe(true);
  });

  it('orders oldest first, so the newest point is on the right of the axis', () => {
    const days = fillDays([], 5, NOW).map((d) => d.day);
    expect([...days].sort()).toEqual(days);
  });

  it('keeps counts attached to their own day', () => {
    const yesterday = cairoDay(new Date(NOW - 86400000));
    const today = cairoDay(new Date(NOW));
    const filled = fillDays(
      [
        { day: today, n: 3 },
        { day: yesterday, n: 9 },
      ],
      3,
      NOW,
    );
    expect(filled.find((d) => d.day === today).n).toBe(3);
    expect(filled.find((d) => d.day === yesterday).n).toBe(9);
  });

  it('survives a null/undefined series without throwing', () => {
    expect(fillDays(null, 3, NOW)).toHaveLength(3);
    expect(fillDays(undefined, 3, NOW).every((d) => d.n === 0)).toBe(true);
  });

  it('groups by Cairo time, not the viewer timezone', () => {
    // 22:30 UTC is already the NEXT day in Cairo (UTC+2/+3).
    const lateUtc = Date.parse('2026-08-12T22:30:00Z');
    expect(cairoDay(new Date(lateUtc))).toBe('2026-08-13');
  });
});

describe('fillHours', () => {
  it('always returns all 24 buckets in order', () => {
    const hours = fillHours([{ hour: 13, n: 4 }]);
    expect(hours).toHaveLength(24);
    expect(hours.map((h) => h.hour)).toEqual([...Array(24).keys()]);
    expect(hours[13].n).toBe(4);
    expect(hours[0].n).toBe(0);
  });

  it('coerces string hours from JSON without losing the bucket', () => {
    expect(fillHours([{ hour: '7', n: '2' }])[7].n).toBe(2);
  });

  it('survives an empty or missing series', () => {
    expect(fillHours(undefined).every((h) => h.n === 0)).toBe(true);
  });
});

/* Masking is a display control, not a security boundary (the raw values are
   in the response either way) — but a screenshot or a shoulder-surfed screen
   should not leak a customer's number or a live bearer token. */
describe('maskPhone', () => {
  it('keeps only the last four digits', () => {
    expect(maskPhone('+201012345678')).toBe('••••• 5678');
  });

  it('never echoes the leading digits of the number', () => {
    expect(maskPhone('+201012345678')).not.toContain('20101');
  });

  it('renders an em dash for a missing number', () => {
    expect(maskPhone(null)).toBe('—');
    expect(maskPhone('')).toBe('—');
  });
});

/* The real control is server-side: admin_redemptions returns `right(code, 4)`,
   so the full bearer token never reaches the browser. maskCode only formats
   that tail — these cases pin the formatting, and the last one pins the
   guarantee that even a full code passed here by mistake is not rendered. */
describe('maskCode', () => {
  it('renders the tail the server sent', () => {
    expect(maskCode('726B')).toBe('••••-726B');
  });

  it('renders an em dash when no tail came back (un-migrated database)', () => {
    expect(maskCode(null)).toBe('—');
    expect(maskCode('')).toBe('—');
  });

  it('still shows only four characters if handed a full code by mistake', () => {
    expect(maskCode('MC-V42Y-726B')).toBe('••••-726B');
    expect(maskCode('MC-V42Y-726B')).not.toContain('V42Y');
  });
});
