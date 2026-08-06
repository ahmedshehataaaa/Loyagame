/* Gameplay — Stitch "McSlice Rush - Gameplay".

   Hosts the preserved canvas engine (engine/game.js) and paints the
   HUD over it. The engine owns its own rAF loop and pointer input;
   this page owns lifecycle: mount, pause, and hard teardown so no
   loop or listener survives a route change. */
import { el, button, iconButton, modal, toast, fmt } from '../components/ui.js';
import { GameEvents, WIN_SCORE, applySoundSetting } from '../adapters/engine-bridge.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

export function PlayPage(root) {
  // Route guard: playing without a profile would produce an unattributable score.
  if (!Store.isSignedIn()) { navigate('/sign-in', { replace: true }); return; }

  const offs = [];
  let ended = false;
  let paused = false;

  /* ---- HUD ------------------------------------------------- */
  const scoreEl = el('b', { class: 'hud__score', text: '0' });
  const timeEl  = el('b', { class: 'hud__time', text: '60' });
  const livesEl = el('span', { class: 'hud__lives', 'aria-label': 'Lives remaining', text: '❤❤❤' });
  const goalEl  = el('span', { class: 'hud__goal', text: `TARGET ${fmt(WIN_SCORE)}` });

  const pauseBtn = iconButton('❚❚', 'Pause game', { onClick: () => togglePause(true) });
  const soundBtn = iconButton(Store.settings().soundEnabled ? '🔊' : '🔇', 'Toggle sound', {
    onClick: () => {
      const on = Store.toggleSound();
      soundBtn.querySelector('span').textContent = on ? '🔊' : '🔇';
      applySoundSetting();
    },
  });

  const hud = el('div', { class: 'hud' },
    el('div', { class: 'hud__pill hud__pill--score' },
      el('small', { text: 'SCORE' }), scoreEl),
    el('div', { class: 'hud__mid' }, goalEl, livesEl),
    el('div', { class: 'hud__right' },
      el('div', { class: 'hud__pill hud__pill--time' }, el('small', { text: 'TIME' }), timeEl),
      soundBtn, pauseBtn),
  );

  /* The engine binds #game once at load, so the canvas lives in the app
     shell permanently. This route reveals it and parks it behind the HUD. */
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  stage.classList.add('is-playing');

  const hint = el('p', { class: 'game-hint', text: 'Swipe across the food to slice it — avoid the burnt fries!' });
  setTimeout(() => hint.classList.add('is-gone'), 3200);

  const screen = el('div', { class: 'screen game-screen' }, hud, hint);
  root.append(screen);

  /* ---- Engine lifecycle ------------------------------------ */
  applySoundSetting();
  try {
    window.Game.init();
    window.Game.startGame();
  } catch (err) {
    console.error('engine failed to start', err);
    screen.append(el('div', { class: 'state' },
      el('span', { class: 'state__glyph', text: '⚠️' }),
      el('p', { class: 'state__title', text: 'Game failed to start' }),
      button('Back to start', { onClick: () => navigate('/') })));
    return () => {};
  }

  /* Poll the engine for HUD values. The engine keeps score in a
     closure, so it is mirrored onto the canvas dataset each frame;
     a 100ms poll is far cheaper than re-rendering every frame. */
  const poll = setInterval(() => {
    if (paused || ended) return;
    const d = canvas.dataset;
    if (d.score !== undefined) {
      scoreEl.textContent = fmt(d.score);
      timeEl.textContent = d.time ?? '';
      const lives = Math.max(0, Number(d.lives ?? 0));
      livesEl.textContent = lives > 0 ? '❤'.repeat(lives) : '💀';
      livesEl.setAttribute('aria-label', `${lives} lives remaining`);
    }
  }, 100);

  /* ---- Pause / resume -------------------------------------- */
  let pauseOverlay = null;
  function togglePause(on) {
    if (ended) return;
    paused = on;
    if (on) {
      try { window.Game.pauseGame(); } catch {}
      pauseOverlay = modal({
        title: 'Paused',
        body: 'Take a breath. Your round is waiting.',
        actions: [
          button('Resume', { onClick: () => togglePause(false) }),
          button('Restart', { variant: 'ghost', onClick: () => { closePause(); restart(); } }),
          button('Quit to home', { variant: 'ghost', onClick: () => { closePause(); navigate('/'); } }),
        ],
        onClose: () => togglePause(false),
      });
      screen.append(pauseOverlay);
    } else {
      closePause();
      try { window.Game.resumeGame(); } catch {}
    }
  }
  function closePause() { pauseOverlay?.remove(); pauseOverlay = null; paused = false; }

  function restart() {
    ended = false;
    try { window.Game.startGame(); } catch (err) { console.error(err); }
  }

  /* ---- Keyboard controls ----------------------------------- */
  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') { e.preventDefault(); togglePause(!paused); }
    if (k === 'r' && ended) restart();
  }
  addEventListener('keydown', onKey);
  offs.push(() => removeEventListener('keydown', onKey));

  /* Leaving the tab pauses, so the round can't drain unattended. */
  function onVis() { if (document.hidden && !paused && !ended) togglePause(true); }
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  /* ---- Round end ------------------------------------------- */
  offs.push(GameEvents.on('ended', (result) => {
    if (ended) return;
    ended = true;

    const run = Store.recordRun({
      score: result.score,
      itemsSliced: Number(canvas.dataset.slices || 0),
      won: result.won,
    });

    if (result.won) { navigate('/win'); return; }

    // Lost: in-design retry, no navigation away.
    const overlay = modal({
      title: "Time's up!",
      body: el('div', null,
        el('p', { class: 'result__score', text: fmt(run.score) }),
        el('p', { class: 't-kicker', text: run.isBest ? 'NEW PERSONAL BEST' : 'FINAL SCORE' }),
        el('p', { style: { marginTop: '10px' }, text:
          `${fmt(Math.max(0, WIN_SCORE - run.score))} more to win the round.` }),
        el('p', { class: 't-kicker', style: { marginTop: '8px' }, text: `+${fmt(run.earned)} REWARD POINTS BANKED` }),
      ),
      actions: [
        button('Play again', { onClick: () => { overlay.remove(); restart(); } }),
        button('Rewards', { variant: 'ghost', onClick: () => navigate('/rewards') }),
        button('Home', { variant: 'ghost', onClick: () => navigate('/') }),
      ],
      onClose: () => { overlay.remove(); navigate('/'); },
    });
    screen.append(overlay);
    toast(`+${fmt(run.earned)} reward points`, 'ok');
  }));

  /* ---- Teardown -------------------------------------------- */
  return () => {
    clearInterval(poll);
    offs.forEach((off) => { try { off(); } catch {} });
    try { window.Game.idle(); } catch {}   // stops spawning; engine goes idle
    stage.classList.remove('is-playing');  // hide the shared canvas again
    pauseOverlay?.remove();
  };
}
