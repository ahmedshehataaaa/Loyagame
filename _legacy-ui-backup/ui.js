/* ============================================================
   UI — HTML overlay screens layered above the game canvas.
   Play-to-win model: loading, phone login, lean home, HUD, pause,
   reward chooser, reward popup, try-again popup, and the waiting page
   (repurposed "locked" screen) shown when a player is capped/locked.
   ============================================================ */

const UI = (() => {
  const ids = ['loading','verify','home','hud','pause','locked','tutorial','privacy','prizes','rank','items','chooser'];
  const screens = {};
  ids.forEach(k => screens[k] = document.getElementById('screen-' + k));

  function show(name) {
    ids.forEach(k => screens[k].classList.toggle('active', k === name));
    if (name !== 'locked') stopCountdown();
    if (window.I18N) I18N.apply();
  }

  // ---- Loading screen --------------------------------------------------
  // Fills the progress bar, then swaps it for a TAP TO START button — the
  // tap doubles as the user gesture that unlocks Web Audio, so the first
  // slice has sound. `onDone` fires on that tap, not on load completion.
  function runLoading(onDone) {
    const bar = document.getElementById('load-bar');
    const tip = document.getElementById('load-tip');
    const tips = ['Sharpening the knives…','Heating the fryer…','Stacking the Big Macs…',
                  'Salting the fries…','Firing up the grill…'];
    let pct = 0, ti = 0;
    tip.textContent = tips[0];

    // Live stat chips on the splash.
    try {
      const best = document.getElementById('splash-best');
      const pts  = document.getElementById('splash-pts');
      if (best) best.textContent = LoyaltyData.getHighScore().toLocaleString();
      if (pts)  pts.textContent  = LoyaltyData.getOrderPoints().toLocaleString();
    } catch {}
    spawnSplashStars();

    const tipInt = setInterval(() => { ti = (ti + 1) % tips.length; tip.textContent = tips[ti]; }, 700);
    const int = setInterval(() => {
      pct += Math.random() * 14 + 5;
      if (pct >= 100) {
        pct = 100; clearInterval(int); clearInterval(tipInt);
        bar.style.width = '100%';
        setTimeout(() => {
          const load = document.getElementById('splash-loading');
          const btn  = document.getElementById('btn-tap-start');
          if (tip) tip.textContent = '';
          if (load) load.style.display = 'none';
          if (btn) {
            btn.hidden = false;
            btn.addEventListener('click', () => { btn.disabled = true; onDone(); }, { once: true });
          } else {
            onDone();               // markup missing — don't strand the player
          }
        }, 300);
      }
      bar.style.width = Math.min(pct, 100) + '%';
    }, 200);
  }

  // Drifting sparkle particles behind the splash logo (pure decoration).
  function spawnSplashStars() {
    const host = document.getElementById('splash-stars');
    if (!host || host.dataset.on) return;
    host.dataset.on = '1';
    const colors = ['#FFC72C', '#ffffff', '#ffe9a8'];
    setInterval(() => {
      if (!document.getElementById('screen-loading').classList.contains('active')) return;
      const s = document.createElement('i');
      s.className = 'splash-star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.color = colors[(Math.random() * colors.length) | 0];
      s.style.setProperty('--tx', ((Math.random() - 0.5) * 160) + 'px');
      s.style.setProperty('--ty', ((Math.random() - 0.5) * 160) + 'px');
      s.style.setProperty('--dur', (2 + Math.random() * 2.5) + 's');
      host.appendChild(s);
      setTimeout(() => s.remove(), 4600);
    }, 320);
  }

  // ---- Phone login (runs every session; no SMS code) -------------------
  function showVerify() {
    const inp = document.getElementById('phone-input');
    inp.value = LoyaltyData.getLastNat();               // prefill for speed
    document.getElementById('country-code').value = LoyaltyData.getLastCC();
    LoyaltyData.setConsent(true);
    document.getElementById('consent').checked = true;
    document.getElementById('verify-error').textContent = '';
    syncSendBtn();
    show('verify');
  }
  function syncSendBtn() {
    const ok = document.getElementById('consent').checked &&
               document.getElementById('phone-input').value.replace(/\D/g,'').length >= 6;
    document.getElementById('btn-send-code').disabled = !ok;
  }

  // ---- Home (lean) -----------------------------------------------------
  function showHome() { refreshHome(); show('home'); }

  function refreshHome() {
    // Home "Hot Now" strip - shows the top reward from the real prize config.
    const hp = document.getElementById('hot-now-prize');
    if (hp) { const t = topPrize(); hp.textContent = t ? t.label : '-'; }

    document.getElementById('home-high').textContent = LoyaltyData.getHighScore().toLocaleString();
    const phoneEl = document.getElementById('home-phone');
    if (phoneEl) phoneEl.textContent = LoyaltyData.getPhone() ? '📱 ' + LoyaltyData.maskedPhone() : '';

    // Order-points hero block (big number + bar) toward the next reward.
    const pts = LoyaltyData.getOrderPoints();
    const thr = LoyaltyData.pointsThreshold();
    const pct = thr > 0 ? Math.min(100, (pts / thr) * 100) : 0;
    const ready = pts >= thr;
    const num = document.getElementById('home-points-num');
    const of = document.getElementById('home-points-of');
    const fill = document.getElementById('home-points-fill');
    const label = document.getElementById('home-points-label');
    const goal = document.getElementById('home-goal');
    if (num) num.textContent = pts.toLocaleString();
    if (of) of.textContent = `OF ${thr.toLocaleString()} ORDER POINTS`;
    if (fill) fill.style.width = pct + '%';
    if (label) {
      label.innerHTML = ready
        ? '🔥 <b>HOT NOW — reward unlocked!</b>'
        : `<b>${(thr - pts).toLocaleString()}</b> until your next reward`;
    }
    if (goal) goal.classList.toggle('ready', ready);
    // "Hot Now" neon sign lights up the moment the reward is unlocked.
    const hotnow = document.getElementById('hotnow');
    if (hotnow) hotnow.classList.toggle('lit', ready);

    // Plays-left badge: the play cap was removed, so there is no count to
    // show. Kept in the DOM (empty) because :empty hides it and a future
    // limit could repopulate it without markup changes.
    const badge = document.getElementById('home-trials');
    if (badge) { badge.textContent = ''; badge.className = 'trials-badge open'; }
  }

  // ---- Waiting page (repurposed "locked" screen) -----------------------
  // reason: 'locked_win' (12h after a win) | 'daily_cap' (5 plays used)
  let cdInt = null;
  function showWaiting(reason, nextPlayAtISO) {
    const title = document.getElementById('locked-title');
    const msg = document.getElementById('locked-msg');
    if (reason === 'locked_win') {
      title.textContent = '🎉 You already won today!';
      msg.textContent = 'Come back after the cooldown for another spin at the wheel.';
    } else if (reason === 'daily_cap') {
      title.textContent = "That's all your plays for now";
      msg.textContent = `You've used all ${LoyaltyData.maxPlays()} plays. Your next play unlocks in:`;
    } else {
      title.textContent = "Can't start right now";
      msg.textContent = 'Please check your connection and try again.';
    }

    const cdEl = document.getElementById('locked-countdown');
    const target = nextPlayAtISO ? new Date(nextPlayAtISO).getTime() : 0;
    const tick = () => {
      if (!target) { cdEl.textContent = ''; return; }
      const ms = Math.max(0, target - Date.now());
      cdEl.textContent = Schedule.formatShort(ms);
      if (ms <= 0) { stopCountdown(); cdEl.textContent = 'Ready!'; }
    };
    tick();
    stopCountdown();
    if (target) cdInt = setInterval(tick, 1000);
    show('locked');
  }
  function stopCountdown() { if (cdInt) { clearInterval(cdInt); cdInt = null; } }

  // ---- Confetti helper -------------------------------------------------
  function confetti(el, n = 40) {
    if (!el) return;
    const colors = ['#fbeef2','#CC083E','#fff','#00764F','#9c0630','#ff6fae','#14a06a'];
    let html = '';
    for (let i = 0; i < n; i++) {
      const left = Math.random() * 100, dur = 2.6 + Math.random() * 2.4,
            delay = -Math.random() * 4, c = colors[(Math.random() * colors.length) | 0];
      html += `<i style="left:${left}%;background:${c};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
    }
    el.innerHTML = html;
  }

  function countUp(el, target, dur = 800) {
    if (!el) return;
    const start = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  // ---- Reward popup ----------------------------------------------------
  function showReward(prize) {
    document.getElementById('reward-glyph').textContent = prize.glyph || '🎉';
    document.getElementById('reward-prize').textContent = prize.label;
    // Redeemable code (Foodics-ready): the cashier enters/scans it at the POS.
    const codeEl = document.getElementById('reward-code');
    if (codeEl) {
      const code = prize.code || '';
      codeEl.textContent = code;
      codeEl.style.display = code ? '' : 'none';
      codeEl.onclick = () => {
        if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
        const prev = codeEl.textContent; codeEl.textContent = 'Copied ✓';
        setTimeout(() => { codeEl.textContent = prev; }, 1000);
      };
    }
    const stamp = document.getElementById('reward-stamp');
    stamp.textContent = 'Valid now · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    confetti(document.getElementById('reward-confetti'), 60);
    document.getElementById('reward-pop').classList.add('show');
  }
  function hideReward() { document.getElementById('reward-pop').classList.remove('show'); }

  // ---- Reward chooser (HOT NOW unlocked) -------------------------------
  // Deterministic player choice — a reward MENU, not a chance wheel
  // (DESIGN.md §6). Points were already spent by submitRun.
  function showChooser(score, result) {
    const nh = document.getElementById('chooser-newhigh');
    if (nh) nh.style.display = result && result.newHigh ? 'block' : 'none';
    confetti(document.getElementById('chooser-confetti'), 30);
    const list = document.getElementById('chooser-list');
    if (list) {
      const prizes = LoyaltyData.wheelPrizes();
      list.innerHTML = prizes.map((p) => `
        <button class="reward-choice" data-key="${p.key}">
          <span class="rc-glyph">${p.glyph}</span>
          <span class="rc-label">${p.label}</span>
        </button>`).join('');
    }
    show('chooser');
  }

  // ---- Results card (round end, no reward unlocked) --------------------
  // Two currencies kept separate: the big number is the GAME SCORE (skill /
  // leaderboard); ORDER POINTS (reward progress) are shown below and are NOT
  // changed by playing — you earn them by ordering.
  function showTryAgain(score, gap, playsLeft, newHigh) {
    const pts = LoyaltyData.getOrderPoints();
    const thr = LoyaltyData.pointsThreshold();
    const close = gap <= thr * 0.2;

    document.getElementById('ta-title').textContent =
      newHigh ? '🏆 NEW HIGH SCORE!' : (close ? '🔥 SO close!' : 'Nice run!');
    document.getElementById('ta-score').textContent = score.toLocaleString();

    const nb = document.getElementById('ta-newbest');
    if (nb) nb.style.display = newHigh ? '' : 'none';


    // Order points — separate currency, earned only by ordering.
    const gapEl = document.getElementById('ta-gap');
    if (gapEl) gapEl.innerHTML = pts >= thr
      ? '🔥 <b>HOT NOW</b> — a reward is ready to claim!'
      : `🔥 Order points <b>${pts.toLocaleString()} / ${thr.toLocaleString()}</b> — order <b>${gap.toLocaleString()}</b> more to unlock a reward`;

    // Play Again only if the player still has plays left this window.
    const again = document.getElementById('btn-ta-again');
    again.style.display = (playsLeft == null || playsLeft > 0) ? '' : 'none';
    document.getElementById('tryagain-pop').classList.add('show');
  }
  function hideTryAgain() { document.getElementById('tryagain-pop').classList.remove('show'); }

  // ---- Rank / live standings -------------------------------------------
  // No ranked endpoint exists yet, so the list stays empty and the empty
  // state carries the screen. renderRank() is the single place to wire a
  // real feed into later.
  // ---- Item Library ----------------------------------------------------
  // Rendered straight from CONFIG (FOODS + BOMB) so the library can never
  // drift from what the engine actually spawns.
  function showItems() { renderItems(); show('items'); }
  function renderItems() {
    const grid = document.getElementById('items-grid');
    if (!grid) return;
    const card = (def, hazard) => `
      <div class="item-card${hazard ? ' is-hazard' : ''}${def.hero ? ' is-hero' : ''}">
        <div class="item-art">
          ${def.img ? `<img src="${def.img}" alt="${def.label}" loading="lazy">`
                    : `<span class="item-glyph">${def.glyph || '\ud83c\udf54'}</span>`}
          ${def.hero ? '<span class="item-flag">SIGNATURE</span>' : ''}
        </div>
        <p class="item-name">${def.label}</p>
        <span class="item-pts${hazard ? ' danger' : ''}">${
          hazard ? 'COSTS A LIFE' : '+' + def.points.toLocaleString() + ' PTS'}</span>
      </div>`;
    const foods = (typeof FOODS !== 'undefined' ? FOODS : [])
      .slice().sort((a, b) => b.points - a.points);
    grid.innerHTML = foods.map(d => card(d, false)).join('') +
      (typeof BOMB !== 'undefined' ? card(BOMB, true) : '');
  }

  // ---- Leaderboard -----------------------------------------------------
  // PROTOTYPE SEED DATA. There is still no ranked backend for this client
  // (see PROGRESS.md), so these rivals are invented purely so the demo
  // reads like a live board. The player's own row below is REAL \u2014 it uses
  // their actual local best score. Delete DEMO_RIVALS and read from a real
  // ranked endpoint before this goes anywhere near production.
  const DEMO_RIVALS = [
    { name: 'McSliceKing',    score: 942000 },
    { name: 'FryFanatic_88',  score: 885200 },
    { name: 'BigMacStacker',  score: 792500 },
    { name: 'SaltySlicer',    score: 710900 },
    { name: 'NuggetNinja',    score: 698000 },
    { name: 'QuarterPounder', score: 550400 },
  ];
  const MEDALS = ['\ud83c\udfc6', '\ud83e\udd48', '\ud83e\udd49'];

  function showRank() { renderRank(); show('rank'); }
  function renderRank() {
    const posEl  = document.getElementById('rank-you-pos');
    const scoreEl = document.getElementById('rank-you-score');
    const list   = document.getElementById('rank-list');
    const empty  = document.getElementById('rank-empty');
    const mine   = LoyaltyData.getHighScore() || 0;

    if (scoreEl) scoreEl.textContent = mine.toLocaleString();

    // Merge the player into the seeded board and rank by score.
    const rows = DEMO_RIVALS.map(r => ({ ...r, you: false }))
      .concat([{ name: 'You', score: mine, you: true }])
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const me = rows.find(r => r.you);
    if (posEl) posEl.textContent = me ? '#' + me.rank : '\u2014';

    if (list) list.innerHTML = rows.map(r => `
      <div class="rk-row${r.you ? ' is-you' : ''}${r.rank <= 3 ? ' is-podium' : ''}">
        <span class="rk-rank">${r.rank <= 3 ? MEDALS[r.rank - 1] : r.rank}</span>
        <span class="rk-name">${r.name}${r.you ? '<i class="rk-youtag">YOU</i>' : ''}</span>
        <span class="rk-score">${r.score.toLocaleString()}</span>
      </div>`).join('');
    if (empty) empty.hidden = rows.length > 0;

    // Teaser shows a real prize from the configured catalogue.
    const teaser = document.getElementById('rank-teaser-label');
    if (teaser) {
      const prizes = (typeof LoyaltyData.wheelPrizes === 'function' && LoyaltyData.wheelPrizes()) || [];
      const pick = prizes.find(p => /fries/i.test(p.label)) || prizes[0];
      if (pick) teaser.textContent = pick.label;
    }
    startRankCountdown();
  }

  // Live countdown to the end of the current calendar month (season reset).
  let rankInt = null;
  function startRankCountdown() {
    const el = document.getElementById('rank-countdown');
    if (!el) return;
    clearInterval(rankInt);
    const tick = () => {
      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      let ms = Math.max(0, end - now);
      const d = Math.floor(ms / 86400000); ms -= d * 86400000;
      const h = Math.floor(ms / 3600000);  ms -= h * 3600000;
      const m = Math.floor(ms / 60000);
      el.textContent = `${d}d ${h}h ${m}m`;
      if (!document.getElementById('screen-rank').classList.contains('active')) {
        clearInterval(rankInt); rankInt = null;
      }
    };
    tick();
    rankInt = setInterval(tick, 30000);
  }

  // ---- Tutorial / privacy ----------------------------------------------
  function showTutorial() { show('tutorial'); }
  function showPrivacy() { show('privacy'); }

  // ---- Prizes + leaderboard (Win Big) ----------------------------------
  function showPrizes() { renderPrizes(); show('prizes'); }
  // The "top reward" is the rarest entry in the real prize config (lowest
  // weight) - derived, never hand-written, so it tracks margin changes.
  function topPrize() {
    // LoyaltyData.wheelPrizes() deliberately strips `weight` (the client is
    // not told the odds), so read the weighted list from the CONFIG mirror
    // for this display-only hint. Falls back to the stripped list's last
    // entry, since the catalogue is authored richest-last.
    const weighted = (typeof CONFIG !== 'undefined' && CONFIG.WHEEL && CONFIG.WHEEL.prizes) || [];
    if (weighted.length) {
      return weighted.reduce((a, b) => ((b.weight ?? Infinity) < (a.weight ?? Infinity) ? b : a));
    }
    const plain = LoyaltyData.wheelPrizes() || [];
    return plain.length ? plain[plain.length - 1] : null;
  }

  function renderPrizes() {
    // Featured prize callout
    const top = topPrize();
    if (top) {
      const g = document.getElementById('wb-fx-glyph');
      const l = document.getElementById('wb-fx-label');
      const n = document.getElementById('wb-fx-note');
      if (g && top.glyph) g.textContent = top.glyph;
      if (l) l.textContent = top.label;
      if (n) n.textContent = LoyaltyData.pointsThreshold().toLocaleString() + ' order points to claim';
    }

    // Reward catalogue
    const pl = document.getElementById('prizes-list');
    if (pl) {
      const prizes = LoyaltyData.wheelPrizes() || [];
      pl.innerHTML = prizes.map((p) => `
        <div class="pr-chip"><span class="pr-g">${p.glyph}</span><span class="pr-l">${p.label}</span></div>`).join('');
    }
  }

  return { show, runLoading, showVerify, syncSendBtn, showHome, refreshHome,
           showWaiting, showReward, hideReward,
           showChooser, showTryAgain, hideTryAgain, showTutorial, showPrivacy, showPrizes,
           showRank, showItems, confetti };
})();
