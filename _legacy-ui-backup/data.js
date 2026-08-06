/* ============================================================
   Player Data Layer  (v5 — play-to-win model, July 2026 pivot)
   ------------------------------------------------------------
   MODEL:
   • Scan-to-play at the cashier. NO competition. The wheel is unlocked by
     the player's real ORDER-POINTS balance (earned ONLY from ordering).
   • order_points >= CONFIG.WHEEL.pointsThreshold → the round's end spins
     the prize wheel → win a discount or free item (server decides which,
     weighted) → the spin SPENDS pointsThreshold points. Repeatable loop.
   • Below the points threshold        → "try again" nudge (shows the gap).
   • Score is still tracked for bragging rights but no longer gates anything.
   • Play limits (server-authoritative, keyed to phone AND device):
       – up to CONFIG.LIMITS.maxPlays rounds per rolling windowHrs
       – winning locks the player out for winLockoutHrs
   • Identity: the player types a phone number EVERY session (no stored
     login), with no SMS verification. A silent per-device id is sent
     alongside so limits can't be reset just by changing the number.

   The server (Netlify Functions → Supabase) is the source of truth for
   eligibility and wheel results. When the API is disabled or the file is
   opened directly (file:// single-file demo), everything falls back to a
   local, lenient offline version so the game is still playable.
   ============================================================ */

const LoyaltyData = (() => {
  const KEY = 'ffninja_profile_v5';
  const DEVICE_KEY = 'ffninja_device_v1';   // survives reset/change-number
  const PLAYS_KEY = 'ffninja_plays_v1';     // offline play log (timestamps)
  const LOCK_KEY = 'ffninja_lockuntil_v1';  // offline win-lockout (ms)
  const POINTS_KEY = 'ffninja_offlinepoints_v1'; // offline/demo order-points store

  const defaults = () => ({
    phone: null,      // full E.164, for masked display
    cc: '+20',        // country code (prefills the selector)
    natNum: null,     // national digits only (prefills the input; sent to API)
    consent: true,
    highScore: 0,
    games: 0,
    orderPoints: 0,   // last-known real order-points balance (for first-paint)
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
    } catch { return defaults(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch {} }
  let profile = load();

  // Session-only state (never persisted — phone login is per-session).
  let verified = false;
  let token = null;               // one-time round token from /start-run
  let eligibility = null;         // last {eligible, reason, nextPlayAt, playsLeft}

  // ---- Silent device id (persistent, its own key) ----------------------
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch {}
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(DEVICE_KEY, id); } catch {}
    }
    return id;
  }

  function normalizePhone(cc, num) {
    const digits = String(num || '').replace(/\D/g, '');
    return { ok: digits.length >= 6 && digits.length <= 13, e164: `${cc}${digits}` };
  }

  // ---- Prize helpers ---------------------------------------------------
  const wheelConfig = () => (typeof CONFIG !== 'undefined' && CONFIG.WHEEL) || { pointsThreshold: 4000, prizes: [] };
  const pointsThresholdVal = () => wheelConfig().pointsThreshold ?? 4000;
  const limits = () => (typeof CONFIG !== 'undefined' && CONFIG.LIMITS) || { maxPlays: 5, windowHrs: 24, winLockoutHrs: 12 };
  const glyphFor = (key) => {
    const p = (wheelConfig().prizes || []).find((x) => x.key === key);
    return p ? p.glyph : '🎁';
  };
  const decorate = (list) => (list || []).map((w) => ({ ...w, glyph: glyphFor(w.key) }));
  function pickPrize(prizes) {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total, acc = 0;
    for (const p of prizes) { acc += p.weight; if (r <= acc) return p; }
    return prizes[0];
  }

  // Redeemable code shown to the player after a win. For the demo this is
  // generated client-side; on a real deploy the SERVER should mint it (stored
  // on the wheel_wins row) and push it to Foodics so the cashier/POS can
  // validate + apply it against the menu. Format: KK-<prize>-<random>.
  function makeRedeemCode(prizeKey) {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `KK-${String(prizeKey || 'WIN').slice(0, 4).toUpperCase()}-${rand}`;
  }


  // ---- Backend API bridge ---------------------------------------------
  const apiCfg = () => (typeof CONFIG !== 'undefined' && CONFIG.API) || { enabled: false };
  // The backend only exists on a real deploy. When opened from file:// or run
  // on localhost (static demo / no Netlify functions), fall back to the fully
  // playable offline path instead of fail-closing on the missing API.
  const isLocalHost = () => /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/.test(location.hostname);
  // Flipped the first time the backend proves unreachable; from then on the
  // game runs entirely on the offline localStorage path.
  let apiDown = false;
  const apiEnabled = () => apiCfg().enabled && location.protocol !== 'file:' && !isLocalHost() && !apiDown;

  // Every call is time-boxed. Without this, a backend that accepts the
  // connection but never responds (e.g. a deploy sitting behind an auth
  // wall) leaves the UI awaiting a promise that never settles - the
  // Continue button just stays disabled forever.
  const API_TIMEOUT_MS = 6000;

  async function api(path, { method = 'POST', body } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(apiCfg().base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      // Network error, abort, CORS, or an auth wall swallowing the request:
      // the backend is unreachable, so stop trying it for this session.
      apiDown = true;
      throw new Error(e.name === 'AbortError' ? 'timeout' : 'unreachable');
    } finally {
      clearTimeout(timer);
    }
    // 401/403 means something in front of the API is rejecting us (Vercel
    // Deployment Protection, an auth proxy). That is a transport problem,
    // not a game rule, so fall back rather than lock the player out.
    if (res.status === 401 || res.status === 403 || res.status >= 500) apiDown = true;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);
    return data;
  }

  // ---- Offline fallback (file:// demo or API unreachable) --------------
  function offPlays() {
    let a = []; try { a = JSON.parse(localStorage.getItem(PLAYS_KEY)) || []; } catch {}
    const cutoff = Date.now() - limits().windowHrs * 3600e3;
    return a.filter((t) => t > cutoff);
  }
  function offRecordPlay() {
    const a = offPlays(); a.push(Date.now());
    try { localStorage.setItem(PLAYS_KEY, JSON.stringify(a)); } catch {}
  }
  function offLockUntil() { try { return Number(localStorage.getItem(LOCK_KEY)) || 0; } catch { return 0; } }
  function offSetLock() {
    try { localStorage.setItem(LOCK_KEY, String(Date.now() + limits().winLockoutHrs * 3600e3)); } catch {}
  }
  // Offline/demo order-points store (file:// demo or API unreachable). The
  // real balance only ever comes from the server; this is a local stand-in
  // so the points gate is exercisable offline and by the dev helper.
  function offPoints() { try { return Number(localStorage.getItem(POINTS_KEY)) || 0; } catch { return 0; } }
  function offSetPoints(n) { try { localStorage.setItem(POINTS_KEY, String(Math.max(0, n | 0))); } catch {} }
  function offAddPoints(n) { const v = offPoints() + (n | 0); offSetPoints(v); return v; }

  function offEligibility() {
    const L = limits();
    // When the post-win lockout is disabled (winLockoutHrs <= 0), ignore any
    // lock — including a stale one stored from a previous win under a longer
    // lockout — so "unlimited" is truly unlimited and never sticks on the
    // waiting screen. Clear the stale key so it can't resurface.
    if (L.winLockoutHrs <= 0) {
      try { localStorage.removeItem(LOCK_KEY); } catch {}
    } else {
      const lock = offLockUntil();
      if (lock > Date.now()) return { eligible: false, reason: 'locked_win', nextPlayAt: new Date(lock).toISOString(), playsLeft: 0 };
    }
    const plays = offPlays();
    if (plays.length >= L.maxPlays) {
      const oldest = plays.sort((a, b) => a - b)[plays.length - L.maxPlays];
      return { eligible: false, reason: 'daily_cap', nextPlayAt: new Date(oldest + L.windowHrs * 3600e3).toISOString(), playsLeft: 0 };
    }
    return { eligible: true, reason: 'ok', playsLeft: L.maxPlays - plays.length };
  }

  return {
    // ---- Identity / session -----------------------------------------
    isVerified() { return verified; },
    getPhone() { return profile.phone; },
    getLastPhone() { return profile.phone; },  // prefill the login field
    getDeviceId: deviceId,
    maskedPhone() {
      const p = profile.phone || '';
      return p ? p.slice(0, p.length - 4).replace(/\d/g, '•') + p.slice(-4) : '';
    },
    setConsent(v) { profile.consent = !!v; save(); },
    hasConsent() { return !!profile.consent; },

    /**
     * Phone login — runs EVERY session (no persisted login). No SMS code
     * (user decision). Captures the number for this session and keeps it
     * only to prefill the field next time. Eligibility is checked
     * separately (checkEligibility) so the caller can route to the
     * waiting page when the player is locked. Synchronous.
     */
    login(cc, num) {
      const { ok, e164 } = normalizePhone(cc, num);
      if (!ok) return { ok: false, error: 'Please enter a valid phone number.' };
      if (!profile.consent) return { ok: false, error: 'Please accept the terms to continue.' };
      profile.phone = e164; profile.cc = cc;
      profile.natNum = String(num).replace(/\D/g, '');
      verified = true; save();
      return { ok: true };
    },
    getLastCC() { return profile.cc || '+20'; },
    getLastNat() { return profile.natNum || ''; },
    changeNumber() { verified = false; token = null; eligibility = null; },

    /**
     * Ask the server whether this phone+device may play now, and refresh the
     * cached order-points balance (used by the home progress bar). Returns
     * { eligible, reason: 'ok'|'locked_win'|'daily_cap', nextPlayAt, playsLeft }.
     * Falls back to the local play log + offline points store when offline.
     */
    async checkEligibility() {
      if (!apiEnabled()) {
        eligibility = offEligibility();
        profile.orderPoints = offPoints();     // offline/demo balance
        save();
        return eligibility;
      }
      try {
        const r = await api('/session-status', { body: { cc: profile.cc, phone: profile.natNum, device: deviceId() } });
        eligibility = { eligible: r.eligible, reason: r.reason, nextPlayAt: r.nextPlayAt, playsLeft: r.playsLeft };
        if (typeof r.orderPoints === 'number') { profile.orderPoints = r.orderPoints; save(); }
      } catch (e) {
        console.warn('eligibility check failed:', e.message);
        if (apiDown) {
          // Backend unreachable -> run as an offline demo so the game stays
          // playable. (When a real backend answers "not eligible" we honour
          // it above; this branch only covers transport failure.)
          eligibility = offEligibility();
          profile.orderPoints = offPoints();
          save();
        } else {
          // Server responded but refused: fail closed, no free play.
          eligibility = { eligible: false, reason: 'offline', nextPlayAt: null, playsLeft: 0 };
        }
      }
      return eligibility;
    },

    /**
     * Request a round. On success returns { granted:true, token, playsLeft }.
     * If locked/capped returns { granted:false, reason, nextPlayAt }.
     * The token must be passed back by submitRun.
     */
    async startPlay() {
      if (!apiEnabled()) {
        const e = offEligibility();
        if (!e.eligible) return { granted: false, reason: e.reason, nextPlayAt: e.nextPlayAt };
        offRecordPlay(); token = 'offline';
        const left = offEligibility().playsLeft;
        return { granted: true, token, playsLeft: left };
      }
      try {
        const r = await api('/start-run', { body: { cc: profile.cc, phone: profile.natNum, device: deviceId() } });
        if (!r.granted) { eligibility = { eligible: false, reason: r.reason, nextPlayAt: r.nextPlayAt, playsLeft: 0 }; return r; }
        token = r.token;
        return r;
      } catch (e) {
        console.warn('start-run failed:', e.message);
        if (apiDown) {
          // Unreachable backend -> grant the round locally so play continues.
          const off = offEligibility();
          if (!off.eligible) return { granted: false, reason: off.reason, nextPlayAt: off.nextPlayAt };
          offRecordPlay(); token = 'offline';
          return { granted: true, token, playsLeft: offEligibility().playsLeft };
        }
        return { granted: false, reason: 'offline', nextPlayAt: null };
      }
    },

    /**
     * Submit a finished round. The wheel is gated on the player's ORDER-POINTS
     * balance (NOT the score): reaching pointsThreshold points spins the wheel
     * and SPENDS those points. Score is still recorded for the high-score.
     * Returns (async):
     *   { won:true,  prize:{key,label,glyph}, prizeIndex, wheel:[{key,label,glyph}], newHigh }
     *   { won:false, gap, newHigh }   // gap = order-points still needed
     * The SERVER decides the wheel result + spends the points; offline uses a
     * local weighted spin against the offline points store.
     */
    async submitRun(score, durationMs) {
      const newHigh = score > profile.highScore;
      if (newHigh) profile.highScore = score;
      profile.games += 1; save();

      const thr = pointsThresholdVal();

      if (!apiEnabled() || token === 'offline') {
        token = null;
        const pts = offPoints();
        if (pts >= thr) {
          offSetPoints(pts - thr);             // spend the points
          profile.orderPoints = offPoints(); save();
          offSetLock();
          const prizes = wheelConfig().prizes || [];
          const prize = pickPrize(prizes);
          const wheel = decorate(prizes.map((p) => ({ key: p.key, label: p.label })));
          const prizeIndex = Math.max(0, wheel.findIndex((w) => w.key === prize.key));
          return { won: true, prize: { key: prize.key, label: prize.label, glyph: glyphFor(prize.key), code: makeRedeemCode(prize.key) }, prizeIndex, wheel, newHigh };
        }
        return { won: false, gap: Math.max(0, thr - pts), newHigh };
      }

      try {
        const r = await api('/submit-run', { body: { token, score, durationMs, device: deviceId() } });
        token = null;
        // Keep the cached balance fresh after a spend/no-spend.
        if (typeof r.orderPoints === 'number') { profile.orderPoints = r.orderPoints; save(); }
        const wheel = decorate(r.wheel);
        if (r.won) {
          return { won: true, prize: { ...r.prize, glyph: glyphFor(r.prize.key), code: r.prize.code || makeRedeemCode(r.prize.key) }, prizeIndex: r.prizeIndex, wheel, newHigh };
        }
        return { won: false, gap: r.gap, newHigh };
      } catch (e) {
        token = null;
        console.warn('submit-run failed:', e.message);
        // Couldn't reach the server: treat as no-win rather than a fake prize.
        return { won: false, gap: Math.max(0, thr - (profile.orderPoints || 0)), newHigh, error: 'offline' };
      }
    },

    // ---- Display helpers --------------------------------------------
    getHighScore() { return profile.highScore; },
    getPlaysLeft() { return eligibility ? eligibility.playsLeft : null; },
    getEligibility() { return eligibility; },
    getOrderPoints() { return profile.orderPoints || 0; },   // cached real balance (server-authoritative)
    pointsThreshold() { return pointsThresholdVal(); },       // order-points needed to spin
    maxPlays() { return limits().maxPlays; },
    wheelPrizes() { return decorate((wheelConfig().prizes || []).map((p) => ({ key: p.key, label: p.label }))); },

    /**
     * Claim a specific reward after HOT NOW is unlocked. The order-points were
     * already spent by submitRun; this is the player's DETERMINISTIC choice
     * from the reward menu — not a chance-based wager (DESIGN.md §6). Returns
     * { key, label, glyph, code }.
     * NOTE (backend follow-up): on a real deploy the SERVER must mint + record
     * this code (a claim_reward RPC writing wheel_wins), and resolve_run must
     * only spend+unlock (no weighted draw), so the code is trackable/Foodics-
     * valid and the choice can't be tampered with.
     */
    claimReward(key) {
      const prizes = wheelConfig().prizes || [];
      const p = prizes.find((x) => x.key === key) || prizes[0];
      if (!p) return null;
      return { key: p.key, label: p.label, glyph: glyphFor(p.key), code: makeRedeemCode(p.key) };
    },

    /**
     * DEV/DEMO ONLY — nudge the LOCAL order-points so the win path is testable
     * without a real order. This NEVER touches the real ledger: online it only
     * bumps the client-side cached/offline value used for display + the offline
     * gate; the authoritative balance still comes from real orders on the next
     * server check. Gated by the caller (main.js) behind the ffn_dev flag.
     */
    devAddPoints(n = 500) {
      offAddPoints(n);                 // demo store (offline gate + persistence)
      profile.orderPoints = Math.max(profile.orderPoints || 0, 0) + (n | 0);
      save();
      if (apiEnabled()) console.info('[dev] devAddPoints: demo-only, does NOT touch the real ledger; real balance refreshes on next server check.');
      return profile.orderPoints;
    },

    reset() {
      profile = defaults(); verified = false; token = null; eligibility = null;
      try {
        localStorage.removeItem(PLAYS_KEY);
        localStorage.removeItem(LOCK_KEY);
        localStorage.removeItem(POINTS_KEY);
      } catch {}
      save();
    },
  };
})();
