/* Formatting + masking for the admin dashboard.

   MASKING IS A DISPLAY CONTROL, NOT A SECURITY BOUNDARY. The admin endpoints
   return full phone numbers and full coupon codes, because the endpoints
   behind them genuinely need them (search, drill-down, staff redemption at a
   counter). Masking here keeps a shoulder-surfed screen — or a screenshot
   pasted into a chat — from leaking a customer's number or a live bearer
   token. Anyone holding the admin key can still read the raw response.
   Treat that as the real trust boundary. */

/** +201012345678 → ••••• 5678. Keeps the last 4, per the brief. */
export function maskPhone(phone) {
  if (!phone) return '—';
  const s = String(phone);
  const tail = s.slice(-4);
  return `••••• ${tail}`;
}

/** Renders the coupon tail the server sent as `••••-726B`.

    The full code never reaches the browser — `admin_redemptions` returns only
    the last four characters, because a coupon is a bearer token and the UI has
    no use for the rest. This function therefore FORMATS an already-masked
    value; it is not itself the masking control. */
export function maskCode(codeTail) {
  if (!codeTail) return '—';
  return `••••-${String(codeTail).slice(-4)}`;
}

const NUM = new Intl.NumberFormat('en-US');
export const num = (n) => NUM.format(Number(n) || 0);

/** One decimal, always with the sign of a percentage. */
export const pct = (n) => `${(Math.round((Number(n) || 0) * 10) / 10).toFixed(1)}%`;

/** Short, unambiguous timestamp in Cairo time — the timezone every server-side
    aggregate in schema.sql groups by, so the dashboard must not disagree. */
const STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : STAMP.format(d);
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  day: '2-digit',
  month: 'short',
});
export function day(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DAY.format(d);
}

/** "14:00" for an hour-of-day bucket. */
export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
