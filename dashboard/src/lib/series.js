/* Chart series preparation.

   Kept out of the chart component so it can be proven in tests/unit/ rather
   than in a browser — per .claude/rules/tests.md, a pure module beats a
   browser test, and headless Chromium's throttled rAF makes chart timing
   unreliable here anyway. */

/* Every server-side aggregate in schema.sql groups by Africa/Cairo, so the
   axis must be built in Cairo time too or the newest bucket lands on the wrong
   day for a viewer in another timezone. en-CA yields the YYYY-MM-DD shape
   to_char() produces. */
const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const cairoDay = (date) => CAIRO_DAY.format(date);

/**
 * admin_engagement() GROUPs BY, so a day with no plays is ABSENT rather than
 * zero. Plotting the sparse rows directly draws a straight line across a dead
 * week, which reads as steady traffic — the gaps must become real zeroes.
 *
 * @param {Array<{day: string, n: number}>} rows sparse rows from the API
 * @param {number} days window length
 * @param {number} [now] epoch ms, injectable so tests are not clock-dependent
 */
export function fillDays(rows, days, now = Date.now()) {
  const byDay = new Map((rows ?? []).map((r) => [r.day, Number(r.n) || 0]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = cairoDay(new Date(now - i * 86400000));
    out.push({ day: key, n: byDay.get(key) ?? 0 });
  }
  return out;
}

/** Same reasoning for hour-of-day: all 24 buckets always exist. */
export function fillHours(rows) {
  const byHour = new Map((rows ?? []).map((r) => [Number(r.hour), Number(r.n) || 0]));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, n: byHour.get(h) ?? 0 }));
}
