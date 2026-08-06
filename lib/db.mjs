/* Shared helpers for the Slicy-P Netlify Functions.
   Talks to Supabase Postgres through PostgREST with plain fetch —
   no npm dependencies, nothing to bundle. The service-role key
   stays server-side; RLS blocks every other key. */

import { createHash, timingSafeEqual } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

export async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const rpc = (fn, args = {}) => sb(`/rpc/${fn}`, { method: 'POST', body: args });

export const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
export const ok = (obj = {}) => json(200, { ok: true, ...obj });
export const bad = (error, status = 400) => json(status, { ok: false, error });

// Mirrors LoyaltyData.normalizePhone (js/data.js): cc + 6–13 digits.
export function normalizePhone(cc, num) {
  const digits = String(num || '').replace(/\D/g, '');
  return { ok: digits.length >= 6 && digits.length <= 13, e164: `${cc}${digits}` };
}

// Looser form for POS payloads: Foodics may send local Egyptian
// numbers ("01xxxxxxxxx") — default those to +20.
export function normalizeLoosePhone(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  if (!digits || digits.length < 6) return null;
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

// Stat months roll over on Cairo time, not the device's.
export function monthKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
  }).format(d); // "YYYY-MM"
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function playerByToken(token) {
  if (!token || !UUID_RE.test(token)) return null;
  const rows = await sb(`/players?device_token=eq.${token}&limit=1`);
  return rows[0] || null;
}

export async function playerByPhone(e164) {
  const rows = await sb(`/players?phone=eq.${encodeURIComponent(e164)}&limit=1`);
  return rows[0] || null;
}

export async function getSettings() {
  const rows = await sb('/settings?select=key,value');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Constant-time secret comparison. Both sides are SHA-256'd first so the
// buffers are always equal length — that keeps timingSafeEqual from throwing
// and stops the comparison leaking the key's length as well as its content.
const digest = (v) => createHash('sha256').update(String(v)).digest();
const secretEquals = (a, b) => {
  if (!a || !b) return false;
  try { return timingSafeEqual(digest(a), digest(b)); } catch { return false; }
};

export const isAdmin = (req) =>
  secretEquals(req.headers.get('x-admin-key'), process.env.ADMIN_KEY);

export const isPosCaller = (req) =>
  isAdmin(req) ||
  secretEquals(req.headers.get('x-webhook-secret'), process.env.FOODICS_WEBHOOK_SECRET);

export async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}
