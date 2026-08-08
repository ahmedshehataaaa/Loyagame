/* ============================================================
   Analytics transport.

   Deliberately has NO vendor. There is no analytics provider chosen for
   this product yet, and picking one is a business/procurement decision
   (data residency, DPA, cost) rather than an engineering one. Inventing an
   endpoint here would either dead-code itself or quietly ship player data
   somewhere nobody agreed to.

   So this collects events through the redacting taxonomy, keeps a bounded
   in-memory buffer, and exposes a single `setSink()` seam. Wiring a vendor
   later is one function call and touches nothing else.

   Analytics must never affect gameplay or rewards: every path here
   swallows its own errors, and nothing awaits a sink.
   ============================================================ */

import { buildPayload, EVENTS, isKnownEvent } from './events.js';

const BUFFER_MAX = 100;

/** @typedef {{name:string, props:Record<string, unknown>, at:number}} AnalyticsEvent */

/** @type {AnalyticsEvent[]} */
let buffer = [];
/** @type {null | ((e: AnalyticsEvent) => void)} */
let sink = null;
let enabled = true;

/* Diagnostics. `redactions` counting up is a signal that a call site is trying
   to send something the taxonomy does not allow — worth noticing in dev rather
   than discarding invisibly. */
const stats = { tracked: 0, rejected: 0, redactions: 0 };

/** Context merged into every event, so call sites need not repeat it. */
let context = {};

/**
 * @param {Record<string, unknown>} next
 */
export function setContext(next) {
  context = { ...context, ...(next ?? {}) };
}

/**
 * Install a transport. Called once at boot when a vendor exists.
 * @param {null | ((e: AnalyticsEvent) => void)} fn
 */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
  // Anything buffered before a sink existed still deserves to be delivered.
  if (sink) flush();
}

export function setEnabled(on) {
  enabled = !!on;
}

/**
 * Record an event.
 *
 * Returns the redacted payload (or null when rejected) so tests and call sites
 * can assert on what would actually leave the device.
 *
 * @param {string} name  must be a member of EVENTS
 * @param {Record<string, unknown>} [props]
 */
export function track(name, props = {}) {
  if (!enabled) return null;

  try {
    const merged = { ...context, ...(props ?? {}) };
    const built = buildPayload(name, merged);

    if (!built.ok) {
      /* An unknown name is a bug at the call site, not a runtime condition to
         handle quietly — a typo'd event silently vanishing is how funnels end
         up wrong for a quarter. */
      stats.rejected++;
      console.warn(`[analytics] unknown event "${name}" — not tracked`);
      return null;
    }

    if (built.dropped.length) {
      stats.redactions += built.dropped.length;
      console.warn(`[analytics] "${name}": dropped disallowed keys [${built.dropped.join(', ')}]`);
    }

    /** @type {AnalyticsEvent} */
    const event = { name: built.name, props: built.props, at: Date.now() };
    stats.tracked++;

    if (sink) {
      try {
        sink(event);
      } catch (err) {
        // A broken sink must not break the game, and must not lose the event.
        console.warn('[analytics] sink threw; buffering instead', err);
        push(event);
      }
    } else {
      push(event);
    }
    return event;
  } catch (err) {
    // Analytics is never allowed to throw into gameplay.
    console.warn('[analytics] track failed', err);
    return null;
  }
}

function push(event) {
  buffer.push(event);
  // Bounded, oldest-out: an unattended tab must not grow this forever.
  while (buffer.length > BUFFER_MAX) buffer.shift();
}

function flush() {
  if (!sink) return;
  const pending = buffer;
  buffer = [];
  for (const event of pending) {
    try {
      sink(event);
    } catch {
      push(event);
    }
  }
}

/** Read-only views, for tests and a future debug panel. */
export const buffered = () => buffer.slice();
export const analyticsStats = () => ({ ...stats });
export function resetAnalytics() {
  buffer = [];
  sink = null;
  enabled = true;
  context = {};
  stats.tracked = 0;
  stats.rejected = 0;
  stats.redactions = 0;
}

export { EVENTS, isKnownEvent };
