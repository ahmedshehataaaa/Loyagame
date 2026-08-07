/* Gameplay — Stitch "McSlice Rush - Gameplay".

   Hosts the preserved canvas engine (engine/game.js) and paints the
   HUD over it. The engine owns its own rAF loop and pointer input;
   this page owns lifecycle: mount, pause, and hard teardown so no
   loop or listener survives a route change. */
import { el, button, iconButton, modal } from '../components/ui.js';
import { GameEvents, applySoundSetting } from '../adapters/engine-bridge.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { startRound, endRound } from '../services/loyalty.js';
import { coachCard, hasSeenCoach } from '../components/coach.js';
import { t, num } from '../core/i18n.js';
import { roundSeconds, startLives } from '../core/rules.js';

/* Round shape comes from the engine config, never from a literal here — these
   were hardcoded to '60' and three hearts, the pre-ADR-0001 values, and stayed
   visibly wrong for the first frames of every round after the round became 30s
   with 2 lives. Read via src/core/rules.js at RENDER time, not module load, so a
   campaign manifest applied after boot actually reaches the HUD. */
const HEART = '❤';

export function PlayPage(root) {
  const ROUND_TIME = roundSeconds();
  const START_LIVES = startLives();
  // Route guard: playing without a profile would produce an unattributable score.
  if (!Store.isSignedIn()) {
    navigate('/sign-in', { replace: true });
    return;
  }

  const offs = [];
  let ended = false;
  let paused = false;

  /* ---- HUD ------------------------------------------------- */
  const scoreEl = el('b', { class: 'hud__score', text: '0' });
  const timeEl = el('b', { class: 'hud__time', text: String(ROUND_TIME) });
  const livesEl = el('span', {
    class: 'hud__lives',
    'aria-label': `${START_LIVES} lives remaining`,
    text: HEART.repeat(START_LIVES),
  });
  // The goal is to last the round, not to reach a score (ADR 0004).
  const goalEl = el('span', {
    class: 'hud__goal',
    text: t('play.survive', { seconds: ROUND_TIME }),
  });

  const pauseBtn = iconButton('❚❚', t('play.pause'), { onClick: () => togglePause(true) });
  const soundBtn = iconButton(
    Store.settings().soundEnabled ? '🔊' : '🔇',
    t('common.toggleSound'),
    {
      onClick: () => {
        const on = Store.toggleSound();
        soundBtn.querySelector('span').textContent = on ? '🔊' : '🔇';
        applySoundSetting();
      },
    },
  );

  const hud = el(
    'div',
    { class: 'hud' },
    el(
      'div',
      { class: 'hud__pill hud__pill--score' },
      el('small', { text: t('play.score') }),
      scoreEl,
    ),
    el('div', { class: 'hud__mid' }, goalEl, livesEl),
    el(
      'div',
      { class: 'hud__right' },
      el(
        'div',
        { class: 'hud__pill hud__pill--time' },
        el('small', { text: t('play.time') }),
        timeEl,
      ),
      soundBtn,
      pauseBtn,
    ),
  );

  /* The engine binds #game once at load, so the canvas lives in the app
     shell permanently. This route reveals it and parks it behind the HUD. */
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  stage.classList.add('is-playing');

  const hint = el('p', {
    class: 'game-hint',
    text: t('play.hint'),
  });
  setTimeout(() => hint.classList.add('is-gone'), 3200);

  /* Says up front whether this round can pay out. Filled in once the server
     answers; a player should never discover only at the end that the round was
     never rewardable. */
  const stakeEl = el('p', { class: 'game-stake', text: '' });

  const screen = el('div', { class: 'screen game-screen' }, hud, hint, stakeEl);
  root.append(screen);

  /* ---- Round session --------------------------------------
     Ask the server to authorise the round. It records the play and issues the
     one-time token that submit-run must present, so the round is bound to a
     real server-initiated session rather than a score posted from nowhere.

     Deliberately non-blocking: the engine starts immediately and the answer
     lands within the first second or two. Making the player wait on a network
     round-trip before the first item flies would be a worse experience than
     labelling an unrewardable round as one. */
  function stakeMessage(session) {
    if (session.rewardable) return { text: t('play.stakePrize'), live: true };
    if (session.denyReason === 'no_identity') return { text: t('play.stakeNoIdentity') };
    if (session.denyReason === 'locked_win') return { text: t('play.stakeLocked') };
    if (session.failure === 'not_configured') return { text: t('play.stakeOff') };
    if (session.failure) return { text: t('play.stakeUnreachable') };
    return { text: t('play.stakeIneligible') };
  }

  /* Every round needs its OWN token: submit-run consumes it, so a replay that
     reused the previous one would be rejected as a replay attempt. Called on
     mount and again on every restart. */
  function acquireSession() {
    stakeEl.className = 'game-stake';
    stakeEl.textContent = '';
    return startRound()
      .then((session) => {
        const { text, live } = stakeMessage(session);
        stakeEl.textContent = text;
        stakeEl.classList.add(live ? 'is-live' : 'is-warn');
      })
      .catch((err) => {
        // A failed session must never block play; it just cannot be rewardable.
        console.error('startRound failed', err);
        stakeEl.textContent = t('play.stakeUnreachable');
        stakeEl.classList.add('is-warn');
      });
  }
  acquireSession();

  /* First-run instruction, over the play screen rather than as a route the
     player taps past before it can help. */
  if (!hasSeenCoach()) {
    const card = coachCard({
      onStart: () => {
        card.remove();
        try {
          window.Game.resumeGame();
        } catch {}
      },
    });
    screen.append(card);
    // Pause behind the card so the round does not drain while it is read.
    setTimeout(() => {
      try {
        window.Game.pauseGame();
      } catch {}
    }, 0);
  }

  /* ---- Engine lifecycle ------------------------------------ */
  applySoundSetting();
  try {
    window.Game.init();
    window.Game.startGame();
  } catch (err) {
    console.error('engine failed to start', err);
    screen.append(
      el(
        'div',
        { class: 'state' },
        el('span', { class: 'state__glyph', text: '⚠️' }),
        el('p', { class: 'state__title', text: t('play.failed') }),
        button(t('err.back'), { onClick: () => navigate('/') }),
      ),
    );
    return () => {};
  }

  /* ---- HUD updates -----------------------------------------
     Event-driven: the engine calls UI.hud() only when a displayed value
     actually changed. This replaced a 100ms setInterval that re-read seven
     `data-*` attributes and rewrote text nodes ten times a second whether or
     not anything had moved. */
  function paintHud(d) {
    if (paused || ended) return;
    scoreEl.textContent = num(d.score);
    timeEl.textContent = String(d.time);
    const lives = Math.max(0, Number(d.lives ?? 0));
    livesEl.textContent = lives > 0 ? HEART.repeat(lives) : '💀';
    livesEl.setAttribute('aria-label', `${lives} lives remaining`);
    // The clock is the win condition, so flag the tense final stretch.
    timeEl.classList.toggle('is-urgent', d.time <= 10);
  }
  offs.push(GameEvents.on('hud', paintHud));

  /* ---- Pause / resume -------------------------------------- */
  let pauseOverlay = null;
  function togglePause(on) {
    if (ended) return;
    paused = on;
    if (on) {
      try {
        window.Game.pauseGame();
      } catch {}
      pauseOverlay = modal({
        title: t('play.paused'),
        body: t('play.pausedBody'),
        actions: [
          button(t('play.resume'), { onClick: () => togglePause(false) }),
          button(t('play.restart'), {
            variant: 'ghost',
            onClick: () => {
              closePause();
              restart();
            },
          }),
          button(t('play.quit'), {
            variant: 'ghost',
            onClick: () => {
              closePause();
              navigate('/');
            },
          }),
        ],
        onClose: () => togglePause(false),
      });
      screen.append(pauseOverlay);
    } else {
      closePause();
      try {
        window.Game.resumeGame();
      } catch {}
    }
  }
  function closePause() {
    pauseOverlay?.remove();
    pauseOverlay = null;
    paused = false;
  }

  function restart() {
    ended = false;
    // A fresh token for the fresh round — see acquireSession().
    acquireSession();
    try {
      window.Game.startGame();
    } catch (err) {
      console.error(err);
    }
  }

  /* ---- Keyboard controls ----------------------------------- */
  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      e.preventDefault();
      togglePause(!paused);
    }
    if (k === 'r' && ended) restart();
  }
  addEventListener('keydown', onKey);
  offs.push(() => removeEventListener('keydown', onKey));

  /* Leaving the tab pauses, so the round can't drain unattended. */
  function onVis() {
    if (document.hidden && !paused && !ended) togglePause(true);
  }
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  /* ---- Round end ------------------------------------------- */
  offs.push(
    GameEvents.on('ended', (result) => {
      if (ended) return;
      ended = true;

      Store.recordRun({
        score: result.score,
        itemsSliced: Number(canvas.dataset.slices || 0),
        won: result.won,
      });

      /* The reward outcome comes from the server via LoyaltyData.submitRun and
         is handed to the result screen as-is.

         Deliberately does NOT write the order-points balance from this object.
         `result` arrives through the engine's UI bridge, which any page script
         can call with anything it likes; an adversarial test showed that
         trusting it here let a forged balance persist to localStorage. The
         loyalty service writes the mirror from the real response instead. */
      Store.setLastReward(result.reward ?? null);

      /* Both outcomes go to the same Result screen (ADR 0010). A win used to
         be a route and a loss an in-place modal, which meant two layouts for
         the same four facts — and they had already drifted apart. */
      navigate('/result');
    }),
  );

  /* ---- Teardown -------------------------------------------- */
  return () => {
    // Drop the round session so a stale token can never be submitted later.
    endRound();
    offs.forEach((off) => {
      try {
        off();
      } catch {}
    });
    try {
      window.Game.idle();
    } catch {} // stops spawning; engine goes idle
    stage.classList.remove('is-playing'); // hide the shared canvas again
    pauseOverlay?.remove();
  };
}
