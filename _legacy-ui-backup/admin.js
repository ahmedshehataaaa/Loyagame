/* ============================================================
   Krispy Kreme × Slicy-P — client-facing performance dashboard
   ============================================================
   SALES/DEMO PROTOTYPE: runs entirely on canned data below so it
   can be shown to Krispy Kreme with zero setup (no Supabase/Netlify
   deploy needed). The shape of DEMO mirrors the real payload
   returned by netlify/functions/client-stats.mjs -> client_dashboard()
   in supabase/schema.sql, so swapping in live data later is just
   replacing loadRange() with a fetch to that endpoint.
   ============================================================ */

const DASH = {
  CURRENCY: 'EGP',

  // Example-only platform revenue-share. Set to 0/undefined to hide
  // the commission card entirely (never shown as a zero).
  COMMISSION_PCT: 5,

  // ---- Demo dataset -------------------------------------------------
  // Grounded in real benchmarks, not round guesses:
  //  - 40% redemption rate matches KFC's Rewards Arcade (a directly
  //    comparable gamified QSR loyalty program) within months of launch.
  //  - ~220 EGP average order value is an ASSUMPTION — Krispy Kreme
  //    doesn't publish Egypt pricing (US dozen pricing runs $13-19) —
  //    tune this once real order data exists.
  //  - Growth rates (+11.4% revenue, +8.2% orders over 30d) are
  //    realistic, not implausibly explosive.
  DATA: {
    '30d': { revenue: 140800, revenueGrowth: 11.4, orders: 640, ordersGrowth: 8.2,
             winsInRange: 210, redeemedInRange: 84, newCustomers: 96,
             topRewards: [
               { label: '5% off',               n: 34 },
               { label: 'Free Original Glazed',  n: 22 },
               { label: '10% off',              n: 15 },
               { label: 'Free coffee',          n: 9  },
               { label: '13% off',              n: 4  },
             ] },
    '7d':  { revenue: 33000, revenueGrowth: 9.8, orders: 150, ordersGrowth: 6.9,
             winsInRange: 50, redeemedInRange: 20, newCustomers: 22,
             topRewards: [
               { label: '5% off',               n: 8 },
               { label: 'Free Original Glazed',  n: 5 },
               { label: '10% off',              n: 4 },
               { label: 'Free coffee',          n: 2 },
               { label: '13% off',              n: 1 },
             ] },
    'today': { revenue: 5060, revenueGrowth: 4.5, orders: 23, ordersGrowth: 3.1,
             winsInRange: 5, redeemedInRange: 2, newCustomers: 3,
             topRewards: [
               { label: '5% off',               n: 1 },
               { label: 'Free Original Glazed',  n: 1 },
             ] },
  },
};

// ---- Demo recent-orders feed (masked at render time, never stored plain in the UI) ----
const DEMO_ORDERS = {
  '30d': [
    ['+201012345678', 260, 25], ['+201123456789', 180, 70], ['+201234567890', 340, 130],
    ['+201598765432', 220, 190], ['+201087654321', 150, 260], ['+201765432109', 300, 340],
    ['+201911223344', 210, 410], ['+201288776655', 240, 500],
  ],
  '7d': [
    ['+201012345678', 260, 25], ['+201123456789', 180, 95], ['+201234567890', 340, 220],
    ['+201598765432', 220, 340], ['+201087654321', 150, 480], ['+201765432109', 300, 610],
  ],
  'today': [
    ['+201012345678', 260, 12], ['+201123456789', 180, 55], ['+201234567890', 340, 140],
    ['+201598765432', 220, 260],
  ],
};

// ---- helpers -------------------------------------------------------
function formatMoney(n) {
  return Math.round(n).toLocaleString('en-US') + ' ' + DASH.CURRENCY;
}
function maskPhone(phone) {
  const head = phone.slice(0, 5), tail = phone.slice(-2);
  return head + '•'.repeat(Math.max(0, phone.length - 7)) + tail;
}
function relTime(minsAgo) {
  if (minsAgo < 60) return minsAgo + 'm ago';
  if (minsAgo < 1440) return Math.round(minsAgo / 60) + 'h ago';
  return Math.round(minsAgo / 1440) + 'd ago';
}
function countUp(el, target, fmt) {
  // ?noanim=1 skips straight to the final value — used for print/screenshot capture.
  if (new URLSearchParams(location.search).has('noanim')) { el.textContent = fmt(target); return; }
  const start = performance.now(), dur = 650;
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function deltaHtml(pct) {
  const up = pct >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// Deterministic wave so the trend line looks organic without being random each reload.
function demoSeries(n, total, seedOffset) {
  const raw = [];
  for (let i = 0; i < n; i++) {
    const trend = 0.7 + 0.6 * (i / Math.max(1, n - 1));
    const wave = 1 + 0.18 * Math.sin((i + seedOffset) * 1.3) + 0.1 * Math.sin((i + seedOffset) * 0.6);
    raw.push(Math.max(0.15, trend * wave));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  const vals = raw.map(v => Math.round((v / sum) * total));
  vals[vals.length - 1] += total - vals.reduce((a, b) => a + b, 0);
  return vals;
}
function seriesLabels(range) {
  const now = new Date();
  if (range === 'today') return ['8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p'];
  const n = range === '7d' ? 7 : 30;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  }
  return out;
}

// ---- render -------------------------------------------------------
let chart = null;

function render(range) {
  const d = DASH.DATA[range];
  const aov = d.revenue / d.orders;
  const redemptionRate = (d.redeemedInRange / d.winsInRange) * 100;

  const hero = document.getElementById('hero');
  hero.innerHTML = `
    <div class="stat">
      <div class="lbl">Revenue</div>
      <div class="num" id="s-revenue">0 ${DASH.CURRENCY}</div>
      ${deltaHtml(d.revenueGrowth)}
    </div>
    <div class="stat">
      <div class="lbl">Orders</div>
      <div class="num" id="s-orders">0</div>
      ${deltaHtml(d.ordersGrowth)}
    </div>
    <div class="stat">
      <div class="lbl">Redemption Rate</div>
      <div class="num" id="s-redemption">0%</div>
    </div>
    <div class="stat">
      <div class="lbl">Avg. Order Value</div>
      <div class="num" id="s-aov">0 ${DASH.CURRENCY}</div>
    </div>
    ${DASH.COMMISSION_PCT ? `
    <div class="stat commission">
      <div class="lbl">Platform Earnings<small>example ${DASH.COMMISSION_PCT}% rate</small></div>
      <div class="num" id="s-commission">0 ${DASH.CURRENCY}</div>
    </div>` : ''}
  `;
  countUp(document.getElementById('s-revenue'), d.revenue, v => formatMoney(v));
  countUp(document.getElementById('s-orders'), d.orders, v => Math.round(v).toLocaleString('en-US'));
  countUp(document.getElementById('s-redemption'), redemptionRate, v => v.toFixed(1) + '%');
  countUp(document.getElementById('s-aov'), aov, v => formatMoney(v));
  if (DASH.COMMISSION_PCT) {
    countUp(document.getElementById('s-commission'), d.revenue * DASH.COMMISSION_PCT / 100, v => formatMoney(v));
  }

  // ---- chart ----
  const n = range === 'today' ? 8 : (range === '7d' ? 7 : 30);
  const series = demoSeries(n, d.revenue, range.length);
  const labels = seriesLabels(range);
  const label = range === '30d' ? 'last 30 days' : range === '7d' ? 'last 7 days' : 'today';
  document.getElementById('chart-sub').textContent = label;

  const ctx = document.getElementById('chart-revenue').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(0,118,79,.16)');
  gradient.addColorStop(1, 'rgba(0,118,79,0)');

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      data: series, borderColor: '#00764F', backgroundColor: gradient,
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: c => formatMoney(c.parsed.y) },
        backgroundColor: '#0a0a0a', padding: 10, cornerRadius: 8,
      } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#a6a6ab', font: { size: 11 }, maxTicksLimit: 8 } },
        y: { grid: { color: '#f0f0f1' }, border: { display: false },
             ticks: { color: '#a6a6ab', font: { size: 11 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } },
      },
    },
  });
  document.getElementById('chart-revenue').style.height = '220px';

  // ---- top rewards ----
  const max = Math.max(...d.topRewards.map(r => r.n));
  document.getElementById('rewards-list').innerHTML = d.topRewards.map(r => `
    <li class="reward-row">
      <div class="line"><span class="label">${r.label}</span><span class="n">${r.n} redeemed</span></div>
      <div class="bar"><i style="width:${(r.n / max) * 100}%"></i></div>
    </li>`).join('');

  // ---- recent orders ----
  document.getElementById('orders-list').innerHTML = DEMO_ORDERS[range].map(([phone, amt, mins]) => `
    <li class="order-row">
      <span class="phone">${maskPhone(phone)}</span>
      <span class="amt">${formatMoney(amt)}</span>
      <span class="when">${relTime(mins)}</span>
    </li>`).join('');
}

document.getElementById('range-pills').addEventListener('click', e => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  document.querySelectorAll('#range-pills button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render(btn.dataset.range);
});

// ?range=today|7d|30d picks the initial view (deep-linkable, also used for screenshots).
const initialRange = DASH.DATA[new URLSearchParams(location.search).get('range')] ? new URLSearchParams(location.search).get('range') : '30d';
document.querySelectorAll('#range-pills button').forEach(b => b.classList.toggle('active', b.dataset.range === initialRange));
render(initialRange);
