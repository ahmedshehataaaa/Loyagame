/* ============================================================
   Bootstrap — wires the DOM to the engine and drives the screen
   flow (play-to-win model):
     load → (tutorial) → phone login → eligibility →
       eligible → home → play → wheel (win) / try-again (lose)
       locked/capped → waiting page with countdown
   ============================================================ */

(function () {
  // One-shot clean slate: open with ?reset to wipe any stale/corrupt local
  // state (old plays, lockouts, saved profile) from earlier builds, then
  // continue booting fresh.
  try { if (new URLSearchParams(location.search).has('reset')) localStorage.clear(); } catch {}

  // Mobile / tablet only — desktops get a "scan on your phone" page + QR.
  if (!Platform.allowed()) {
    document.getElementById('desktop-gate').classList.add('show');
    document.getElementById('stage').style.display = 'none';
    document.getElementById('rotate').classList.remove('show');
    const url = location.href.split('?')[0];
    const qr = document.getElementById('gate-qr');
    qr.addEventListener('error', () => { qr.style.display = 'none'; });
    qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=440x440&data=' + encodeURIComponent(url);
    document.getElementById('gate-url').textContent = url;
    if (window.I18N) I18N.apply();
    return;
  }

  applyBrand();
  I18N.apply();
  registerServiceWorker();
  Game.init();

  const $ = id => document.getElementById(id);
  const btn = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { Sound.unlock(); Sound.click(); fn(); }); };

  function applyBrand() {
    const root = document.documentElement.style;
    const c = BRAND.colors;
    root.setProperty('--tomato', c.primary);  root.setProperty('--tomato2', c.primary2);
    root.setProperty('--gold', c.accent);     root.setProperty('--gold2', c.accent2);
    root.setProperty('--green', c.green);     root.setProperty('--green2', c.green2);
    root.setProperty('--sky1', c.sky1);       root.setProperty('--sky2', c.sky2);
    root.setProperty('--sky3', c.sky3);
  }

  function registerServiceWorker() {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    if (window.Theme && Theme.DESIGN_MODE) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
      }
      return;
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---- Eligibility routing ---------------------------------------------
  // After login (or a finished win/round), decide: home, or waiting page.
  async function routeByEligibility() {
    const e = await LoyaltyData.checkEligibility();
    if (e && e.eligible) { UI.showHome(); }
    else { UI.showWaiting(e ? e.reason : 'offline', e ? e.nextPlayAt : null); }
  }

  // ---- Start a round (server grants a token, or sends us to waiting) ----
  async function tryPlay() {
    const play = $('btn-play');
    if (play) play.disabled = true;
    const r = await LoyaltyData.startPlay();
    if (play) play.disabled = false;
    if (r.granted) { Game.startGame(); }
    else { UI.showWaiting(r.reason, r.nextPlayAt); }
  }

  // ---- Phone login (no SMS code) ---------------------------------------
  $('phone-input').addEventListener('input', UI.syncSendBtn);
  $('consent').addEventListener('change', e => { LoyaltyData.setConsent(e.target.checked); UI.syncSendBtn(); });

  btn('btn-send-code', async () => {
    const cc = $('country-code').value;
    const num = $('phone-input').value;
    $('verify-error').textContent = '';
    const b = $('btn-send-code');
    b.disabled = true;
    const res = LoyaltyData.login(cc, num);
    if (!res.ok) { $('verify-error').textContent = res.error; b.disabled = false; return; }
    Sound.reward();
    await routeByEligibility();     // → home or waiting page
    b.disabled = false;
  });

  // ---- Home ------------------------------------------------------------
  btn('btn-play', tryPlay);
  btn('btn-prizes', () => UI.showPrizes());
  btn('btn-prizes-back', () => UI.showHome());
  btn('btn-hot-now',     () => UI.showPrizes());
  // "Bake more points": points come only from ordering, so this returns the
  // player to the home screen where the reward meter shows their progress.
  btn('btn-prizes-more', () => UI.showHome());
  btn('btn-rank-back',    () => UI.showHome());
  btn('btn-rank-play',    tryPlay);
  // ---- Item Library ----------------------------------------------------
  btn('btn-items-back',   () => UI.showHome());
  btn('btn-items-play',   tryPlay);
  btn('btn-home-change', () => { LoyaltyData.changeNumber(); UI.showVerify(); });


  // ---- Home header + bottom nav ---------------------------------------
  // These were inert <span>s from the Stitch export; they are real buttons
  // now and route to screens that actually exist.
  btn('btn-home-menu',    () => UI.showPrivacy());
  btn('btn-home-profile', () => { LoyaltyData.changeNumber(); UI.showVerify(); });
  btn('btn-nav-home',     () => UI.showHome());
  btn('btn-nav-play',     tryPlay);
  btn('btn-nav-prizes',   () => UI.showPrizes());
  btn('btn-nav-rank',     () => UI.showRank());
  btn('btn-nav-items',    () => UI.showItems());

  // ---- HUD / pause -----------------------------------------------------
  btn('btn-pause', () => Game.pauseGame());
  btn('btn-resume', () => Game.resumeGame());
  btn('btn-quit', () => { Game.idle(); UI.showHome(); });


  // ---- Reward chooser (HOT NOW unlocked) — deterministic pick, not a wager
  const chooserList = $('chooser-list');
  if (chooserList) chooserList.addEventListener('click', (e) => {
    const btn = e.target.closest('.reward-choice');
    if (!btn) return;
    Sound.unlock(); Sound.click(); Sound.reward();
    const prize = LoyaltyData.claimReward(btn.dataset.key);
    if (prize) UI.showReward(prize);
  });
  // After a win the player is locked out — route to the waiting page.
  btn('btn-reward-done', async () => {
    UI.hideReward();
    Game.idle();
    await routeByEligibility();
  });

  // ---- Try-again popup -------------------------------------------------
  btn('btn-ta-again', () => { UI.hideTryAgain(); tryPlay(); });
  btn('btn-ta-home', () => { UI.hideTryAgain(); Game.idle(); UI.showHome(); });

  // ---- Waiting page ----------------------------------------------------
  btn('btn-locked-home', () => { Game.idle(); routeByEligibility(); });

  // ---- Tutorial / privacy / language -----------------------------------
  btn('btn-tutorial-done', () => { try { localStorage.setItem('ffn_seen_tutorial', '1'); } catch {} afterTutorial(); });
  btn('btn-privacy', () => UI.showPrivacy());
  btn('btn-privacy-back', () => UI.showVerify());
  btn('btn-lang', () => { I18N.toggle(); UI.refreshHome(); });

  function afterTutorial() {
    Game.idle();
    if (LoyaltyData.isVerified()) routeByEligibility();
    else UI.showVerify();
  }

  // ---- Mute ------------------------------------------------------------
  const muteBtn = $('btn-mute');
  if (muteBtn) muteBtn.addEventListener('click', () => {
    Sound.unlock();
    const ic = $('mute-ic');
    if (ic) ic.textContent = Sound.toggleMute() ? '🔇' : '🔊';
  });

  // ---- Keyboard --------------------------------------------------------
  // Dev flag mirrors Platform's ffn_dev override (also set via ?dev below).
  let devMode = false;
  try {
    devMode = localStorage.getItem('ffn_dev') === '1';
    if (new URLSearchParams(location.search).has('dev')) { localStorage.setItem('ffn_dev', '1'); devMode = true; }
  } catch {}

  window.addEventListener('keydown', e => {
    const s = Game.getScene();
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
      if (s === Game.SCENE.PLAYING) Game.pauseGame();
      else if (s === Game.SCENE.PAUSED) Game.resumeGame();
    }
    // Dev helper: credit +500 demo order-points to exercise the wheel gate
    // locally (never touches the real ledger — see LoyaltyData.devAddPoints).
    if (devMode && e.key.toLowerCase() === 'o') {
      const total = LoyaltyData.devAddPoints(500);
      console.info('[dev] order-points →', total);
      const homeEl = document.getElementById('screen-home');
      if (homeEl && homeEl.classList.contains('active')) UI.refreshHome();
    }
  });

  // ---- Boot: load → (first-time tutorial) → login ----------------------
  UI.runLoading(() => {
    Game.idle();
    let seen = false;
    try { seen = localStorage.getItem('ffn_seen_tutorial') === '1'; } catch {}
    if (!seen) UI.showTutorial();
    else afterTutorial();
  });
})();
