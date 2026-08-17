/* Gameplay — Stitch "McSlice Rush - Gameplay".

   Hosts the preserved canvas engine (engine/game.js) and paints the
   HUD over it. The engine owns its own rAF loop and pointer input;
   this page owns lifecycle: mount, pause, and hard teardown so no
   loop or listener survives a route change. */
import { el, button, iconButton, modal } from '../components/ui.js';
import { icon, setIcon } from '../components/icons.js';
import { GameEvents, applySoundSetting } from '../adapters/engine-bridge.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { startRound, endRound } from '../services/loyalty.js';
import { coachCard, hasSeenCoach, markCoachSeen } from '../components/coach.js';
import { spinWheel } from '../components/spin-wheel.js';
import { t, num } from '../core/i18n.js';
import { roundSeconds, startLives, minRoundScoreForWheel } from '../core/rules.js';
import { track, EVENTS } from '../analytics/index.js';

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
  /** Remembered so REPLAY_STARTED can say what the player is replaying after. */
  let lastOutcome = null;

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
    icon(Store.settings().soundEnabled ? 'soundOn' : 'soundOff'),
    t('common.toggleSound'),
    {
      onClick: () => {
        const on = Store.toggleSound();
        setIcon(soundBtn.querySelector('span'), on ? 'soundOn' : 'soundOff');
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
     shell permanently. This route reveals it and parks it behind the HUD.
     #route sits above #stage in the stacking order; with overflow-y:auto and
     -webkit-overflow-scrolling:touch it intercepts every swipe on mobile even
     though the game-screen overlay inside it is pointer-events:none. Setting
     pointer-events:none on #route itself lets events fall through to the canvas. */
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const routeEl = root; // root IS #route
  stage.classList.add('is-playing');
  routeEl.style.pointerEvents = 'none';

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
        // Whether the round could pay out is the single most useful dimension
        // on this event: it splits practice traffic from prize traffic.
        track(EVENTS.GAME_STARTED, {
          rewardable: !!session.rewardable,
          roundSeconds: ROUND_TIME,
          lives: START_LIVES,
        });
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
  const needsCoach = !hasSeenCoach();
  if (needsCoach) {
    track(EVENTS.INSTRUCTIONS_VIEWED, { trigger: 'first_run' });
    let started = false;
    const startPlaying = () => {
      if (started) return; // pointerdown and the button's click can both arrive
      started = true;
      markCoachSeen();
      card.remove();
      try {
        window.Game.resumeGame();
      } catch {}
    };
    const card = coachCard({ onStart: startPlaying });
    /* ANY tap on the card starts the round, not just the "start" button.
       The button is a ~303x69 target inside a full-screen panel, and the card
       only listened on the button itself plus the backdrop STRICTLY outside the
       panel (`e.target !== overlay` bails). A tap that landed on the rules list
       — measurably where a centre-of-button tap actually lands — matched
       neither, so the card stayed up. That matters far more than a missed tap:
       the engine is PAUSED while the card is shown, and `handleMove()` returns
       immediately when `scene !== SCENE.PLAYING`, so every swipe was silently
       discarded and the game looked like slicing was broken. */
    card.addEventListener('pointerdown', startPlaying);
    screen.append(card);
  }

  /* ---- Engine lifecycle ------------------------------------ */
  applySoundSetting();
  // Defer one frame so the browser finishes laying out the stage before
  // resize() reads window.innerWidth/innerHeight into the canvas dimensions.
  // If the coach card is showing, pause immediately after startGame so the
  // round timer doesn't drain while the player reads the instructions.
  let initRaf = requestAnimationFrame(() => {
    initRaf = null;
    try {
      window.Game.init();
      window.Game.startGame();
      if (needsCoach) window.Game.pauseGame();
    } catch (err) {
      console.error('engine failed to start', err);
      screen.append(
        el(
          'div',
          { class: 'state' },
          el('span', { class: 'state__glyph' }, icon('alert', { size: 40 })),
          el('p', { class: 'state__title', text: t('play.failed') }),
          button(t('err.back'), { onClick: () => navigate('/') }),
        ),
      );
    }
  });

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
      track(EVENTS.GAME_PAUSED, { reason: document.hidden ? 'tab_hidden' : 'player' });
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
      track(EVENTS.GAME_RESUMED, {});
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
    track(EVENTS.REPLAY_STARTED, { previousOutcome: lastOutcome ?? 'unknown' });
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

      /* Round outcome, then reward outcome — two separate events because they
         are two separate questions (ADR 0004/0009) and a funnel needs to see
         survivors who still got nothing. */
      lastOutcome = result.won ? 'won' : 'lost';
      track(result.won ? EVENTS.GAME_WON : EVENTS.GAME_LOST, {
        score: Number(result.score) || 0,
        itemsSliced: Number(result.itemsSliced) || 0,
        bestCombo: Number(result.bestCombo) || 0,
        durationMs: Number(result.durationMs) || 0,
      });

      const reward = result.reward ?? null;
      if (reward) {
        if (reward.status === 'awarded' && reward.prize) {
          // The prize KEY only. The code is a bearer token and never leaves.
          track(EVENTS.REWARD_ISSUED, {
            prizeKey: reward.prize.key,
            orderPoints: reward.orderPoints ?? undefined,
          });
        } else if (reward.status === 'not_eligible') {
          track(EVENTS.REWARD_ELIGIBLE, {
            orderPoints: reward.orderPoints ?? undefined,
            pointsThreshold: reward.pointsThreshold ?? undefined,
          });
        } else if (reward.status === 'flagged') {
          track(EVENTS.SUSPICIOUS_ACTIVITY, { signal: 'server_flagged_run', scope: 'submit_run' });
        } else if (reward.status === 'error' || reward.status === 'pending') {
          track(EVENTS.ERROR_ENCOUNTERED, { scope: 'reward', kind: reward.status, route: '/play' });
        }
      }

      /* LOSS: straight to the Result screen. No wheel — a wheel that turns and
         lands on nothing reads as a loss the player caused, when they simply
         were not eligible. */
      if (!result.won) {
        navigate('/result');
        return;
      }

      /* SCORE GATE: surviving wins the round (ADR 0004 — score does not decide
         that, and this does not change it), but the wheel is a skill reward and
         needs a real round behind it. Under the bar the win still lands on the
         Result screen, just without a spin. Kept here, at the same branch that
         already decides wheel-vs-result, rather than folded into
         resolveOutcome(): that function answers "did they survive", and the
         2026-08-07 audit finding was precisely that a score test had been
         allowed to masquerade as the win condition. */
      const minScore = minRoundScoreForWheel();
      if (minScore > 0 && (Number(result.score) || 0) < minScore) {
        navigate('/result');
        return;
      }

      /* WIN: reveal through the Spin to Win wheel (ADR 0016).

         The server has ALREADY minted the coupon and chosen the prize by this
         point — `LoyaltyData.submitRun()` awaited it above. So `mintCoupon`
         hands the wheel a decision that is already recorded, and the spin can
         only ever reveal it. The wheel is not the randomness source, and there
         is no path here that could make it one. */
      const overlay = spinWheel({
        serverWheel: reward?.wheel ?? null,
        /* Reveal ONLY what the server minted. This briefly picked a prize here
           with Math.random() and a null code when the server had not awarded
           one — a prize invented by the client, shown as if it were real, with
           nothing to redeem. That is the exact failure the server-authoritative
           rule exists to prevent (CLAUDE.md; ADR 0009). If the mint did not
           happen, the wheel shows its own error state and offers a retry; it
           never dresses a failure up as a win. */
        mintCoupon: async () => reward,
        onDone: () => {
          overlay.remove();
          navigate('/result');
        },
        onWallet: () => {
          overlay.remove();
          navigate('/wallet');
        },
        onSignIn: () => {
          overlay.remove();
          navigate('/sign-in');
        },
      });
      screen.append(overlay);
    }),
  );

  /* ---- Teardown -------------------------------------------- */
  return () => {
    if (initRaf) cancelAnimationFrame(initRaf);
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
    routeEl.style.pointerEvents = ''; // restore so other routes scroll normally
    pauseOverlay?.remove();
  };
}
