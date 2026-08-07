#!/usr/bin/env node
/* Measures what Stage 8 claims to improve, on a THROTTLED profile.
 *
 * Numbers taken on an unthrottled desktop are meaningless for a game whose
 * target is an ordinary mid-range phone, so this runs with 4x CPU throttling
 * and a slow-3G-ish network by default. It reports rather than asserts: the
 * pass/fail gate lives in tests/e2e/performance.spec.js, which uses looser
 * bounds so it is not flaky. */
import { chromium } from '@playwright/test';

const URL = process.env.PERF_URL ?? 'http://127.0.0.1:8765/index.html';
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

/* ---- Cold load ------------------------------------------------------- */
/* Bytes come from the Resource Timing API, not from Content-Length headers.
   The dev server does not send Content-Length on every response, so a
   header-based tally reported a flat 0.0 KB — a measurement that silently
   reads zero is worse than no measurement. `encodedBodySize` is what actually
   crossed the wire. */
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.welcome', { timeout: 15000 });
const firstPaintReady = Date.now() - t0;

const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint');
  const resources = performance.getEntriesByType('resource');
  const byType = {};
  let total = n?.encodedBodySize ?? 0;
  for (const r of resources) {
    const bytes = r.encodedBodySize || r.transferSize || 0;
    const ext = (new URL(r.name).pathname.match(/\.(\w+)$/)?.[1] ?? 'other').toLowerCase();
    byType[ext] = (byType[ext] ?? 0) + bytes;
    total += bytes;
  }
  return {
    bytesTotal: total,
    bytesByType: byType,
    domContentLoaded: Math.round(n?.domContentLoadedEventEnd ?? 0),
    loadEvent: Math.round(n?.loadEventEnd ?? 0),
    firstPaint: Math.round(paints.find((p) => p.name === 'first-paint')?.startTime ?? 0),
    firstContentfulPaint: Math.round(
      paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0,
    ),
    requests: performance.getEntriesByType('resource').length,
  };
});

/* ---- In-round frame rate --------------------------------------------- */
await page.addInitScript(() => localStorage.setItem('mcslice.coached.v1', '1'));
await page.goto(`${URL}#/play`, { waitUntil: 'load' });
// A guest profile is enough to pass the /play route guard.
await page.evaluate(() =>
  localStorage.setItem(
    'mcslice.v1',
    JSON.stringify({
      profile: { id: 'perf', name: 'Perf', isGuest: true },
      progress: {
        rewardPoints: 0,
        bestScore: 0,
        lastScore: 0,
        gamesPlayed: 0,
        redeemedRewardIds: [],
        lastRun: null,
      },
      settings: { soundEnabled: false, reducedMotion: false },
    }),
  ),
);
await page.goto(`${URL}#/play`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const fps = await page.evaluate(async (ms) => {
  const frames = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now - frames.t0 > ms) return resolve(undefined);
      requestAnimationFrame(tick);
    };
    frames.t0 = performance.now();
    requestAnimationFrame(tick);
    setTimeout(resolve, ms + 500);
  });
  const deltas = frames.filter((d) => d > 0).sort((a, b) => a - b);
  if (!deltas.length) return null;
  const p = (q) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * q))];
  return {
    samples: deltas.length,
    medianMs: +p(0.5).toFixed(2),
    p95Ms: +p(0.95).toFixed(2),
    approxFps: +(1000 / p(0.5)).toFixed(1),
  };
}, 3000);

const mem = await page.evaluate(() => {
  const m = performance.memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
});

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`\nMcSlice Rush — performance baseline`);
console.log(`URL ${URL}   CPU throttle ${CPU_THROTTLE}x   viewport 390x844\n`);
console.log(`Cold load`);
console.log(`  first paint              ${nav.firstPaint} ms`);
console.log(`  first contentful paint   ${nav.firstContentfulPaint} ms`);
console.log(`  DOMContentLoaded         ${nav.domContentLoaded} ms`);
console.log(`  load event               ${nav.loadEvent} ms`);
console.log(`  welcome interactive      ${firstPaintReady} ms (wall clock)`);
console.log(`  requests                 ${nav.requests}`);
console.log(`  transferred              ${kb(nav.bytesTotal)}`);
for (const [ext, n] of Object.entries(nav.bytesByType).sort((a, b) => b[1] - a[1])) {
  if (n > 0) console.log(`    ${ext.padEnd(6)} ${kb(n)}`);
}
console.log(`\nIn-round (throttled ${CPU_THROTTLE}x)`);
if (fps) {
  console.log(`  frame delta median       ${fps.medianMs} ms  (~${fps.approxFps} fps)`);
  console.log(`  frame delta p95          ${fps.p95Ms} ms`);
  console.log(`  samples                  ${fps.samples}`);
} else {
  console.log('  frame data unavailable (headless rAF throttling)');
}
if (mem !== null) console.log(`  JS heap                  ${mem} MB`);

await browser.close();
