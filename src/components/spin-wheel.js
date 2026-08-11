/* ============================================================
   Spin to Win — the reward reveal.

   THE ORDER MATTERS, AND IT IS NOT NEGOTIABLE:
     1. the server mints the coupon and decides the prize,
     2. THEN the wheel animates,
     3. and it lands on whatever the server already chose.

   The spin is a REVEAL, not the randomness source. If the wheel picked and
   the client then asked the server to honour it, the client would be
   deciding a real-money outcome — the exact class of bug ADR 0009 closed.
   `resolve_run` performs the weighted draw inside a row-locked transaction;
   this component only knows which segment to stop on.

   Visual reference: 04_spin_to_win_screen.png — red ground, gold arches,
   "SPIN TO WIN" in wide-tracked white caps, a gold-ringed wheel of product
   cards on a pale interior, a gold pointer at the top, and a full-width gold
   SPIN NOW button.
   ============================================================ */
import { el, button } from './ui.js';
import { t, num } from '../core/i18n.js';
import { prizes as configuredPrizes } from '../core/rules.js';

/* Timings. The spin is long enough to feel like an event and short enough
   that a player who has already won does not sit waiting for permission. */
const SPIN_MS = 4200;
const SETTLE_MS = 450;

const REWARD_STATUS_NOT_SIGNED_IN = 'not_signed_in';

/* Outcomes that are a settled ANSWER, not a fault.
 *
 * The distinction decides which buttons the player gets, and getting it wrong
 * is what produced the original complaint: every one of these used to fall
 * through to the error branch, so a guest was offered "Try again" under a
 * message claiming rewards did not exist in this build. Retrying cannot help
 * with any of these — each needs a different action, or none. */
const DENIALS = new Set(['not_eligible', 'eliminated', REWARD_STATUS_NOT_SIGNED_IN, 'unavailable']);

/** Segment art: match a prize key to a sprite, falling back to its glyph. */
const PRIZE_ART = {
  fries: 'assets/items/fries.png',
  bigmac: 'assets/items/bigmac.png',
  nuggets: 'assets/items/nuggets.png',
  mcflurry: 'assets/items/mcflurry.png',
  hashbrown: 'assets/items/hashbrown.png',
  applepie: 'assets/items/applepie.png',
  filetofish: 'assets/items/filetofish.png',
};

/**
 * The wheel's segment order.
 *
 * Taken from the SERVER's `wheel` array when it sends one, so the animation
 * and the award cannot disagree. Falls back to the client's configured prize
 * list purely so the wheel can be laid out before a response arrives.
 */
export function wheelSegments(serverWheel) {
  const source =
    Array.isArray(serverWheel) && serverWheel.length ? serverWheel : configuredPrizes();
  return source.map((p) => ({
    key: p.key,
    label: p.label,
    glyph: p.glyph ?? '🎁',
    art: PRIZE_ART[p.key] ?? null,
  }));
}

/**
 * Rotation, in degrees, that brings `index` under the pointer at the top.
 *
 * Exported and pure so the maths can be tested without a DOM: landing on the
 * wrong segment would show a player a prize they were not given.
 */
export function rotationForIndex(index, count, turns = 5) {
  if (!Number.isFinite(index) || count <= 0) return turns * 360;
  const step = 360 / count;
  // Segment i is drawn centred at i*step from the top, so the wheel must turn
  // BACK by that much to bring it under the pointer.
  const target = (360 - ((index * step) % 360)) % 360;
  return turns * 360 + target;
}

/**
 * One segment card.
 *
 * The card sits at the TOP of a full-size layer that rotates about the wheel's
 * centre, so the orbit radius is the WHEEL's box. Translating the card itself
 * by a percentage resolves against the card's own height instead, which threw
 * every segment outside the disc.
 *
 * The card counter-rotates by the same angle so product art stays upright, as
 * in the reference.
 */
function segmentCard(seg, i, count) {
  const angle = (360 / count) * i;
  const card = el(
    'div',
    { class: 'wheel__seg', style: { transform: `rotate(${angle}deg)` } },
    el(
      'div',
      {
        class: 'wheel__card',
        /* Counters its own segment angle AND, once settled, the disc's final
           rotation — so labels are readable at rest. During the spin the cards
           turn with the wheel, which is what a real wheel does. */
        style: { '--seg-a': `${angle}deg` },
      },
      seg.art
        ? el('img', {
            class: 'wheel__art',
            src: seg.art,
            alt: '',
            loading: 'eager',
            onError: (e) => {
              e.target.replaceWith(el('span', { class: 'wheel__glyph', text: seg.glyph }));
            },
          })
        : el('span', { class: 'wheel__glyph', text: seg.glyph }),
      el('span', { class: 'wheel__label', text: seg.label }),
    ),
  );
  return card;
}

/**
 * Build the Spin to Win overlay.
 *
 * @param {object} o
 * @param {() => Promise<import('../services/reward-state.js').RewardOutcome>} o.mintCoupon
 *   Calls the server FIRST. Must resolve to a RewardOutcome.
 * @param {any[]} [o.serverWheel] segment order, when already known
 * @param {(outcome:any)=>void} [o.onDone] after the reveal, or after an error
 * @param {(outcome:any)=>void} [o.onWallet]
 * @param {(outcome:any)=>void} [o.onSignIn] offered when the denial is "not signed in"
 * @returns {HTMLElement}
 */
export function spinWheel({ mintCoupon, serverWheel, onDone, onWallet, onSignIn }) {
  const segments = wheelSegments(serverWheel);
  const count = segments.length;

  const disc = el(
    'div',
    { class: 'wheel__disc' },
    ...segments.map((s, i) => segmentCard(s, i, count)),
    el('span', { class: 'wheel__hub' }),
  );

  /* Card width is derived from the segment COUNT, not fixed.
     Ten prizes at a fixed 25% overlapped each other and clipped their labels;
     a campaign with three would have looked sparse. The arc available to each
     card is (2*pi*r)/count of the wheel's width, and 0.78 of that leaves a
     visible gap between neighbours. */
  const orbitFrac = 0.35; // card centre, as a fraction of wheel width from centre
  const arcFrac = ((2 * Math.PI * orbitFrac) / Math.max(1, count)) * 0.78;
  const segWidth = Math.max(0.12, Math.min(0.26, arcFrac));

  const wheel = el(
    'div',
    {
      class: 'wheel',
      'aria-hidden': 'true',
      style: { '--seg-w': `${(segWidth * 100).toFixed(1)}%` },
    },
    el('span', { class: 'wheel__pointer' }),
    disc,
  );

  const title = el('h1', { class: 'spin__title', text: t('spin.title') });
  const sub = el('p', { class: 'spin__sub', text: t('spin.sub') });

  /* Live region: the wheel itself is decorative, so the outcome has to be
     announced in text or a screen-reader user gets nothing at all. */
  const status = el('div', { class: 'spin__status', role: 'status', 'aria-live': 'polite' });

  /* `data-act` names each action independently of its label, so a test — or a
     screenshot script — can drive the reveal in Arabic as well as English.
     The accessible name stays the visible text; this is addressing, not
     labelling. */
  const spinBtn = button(t('spin.cta'), { onClick: () => start(), 'data-act': 'spin' });
  const actions = el('div', { class: 'spin__actions' }, spinBtn);

  const panel = el('div', { class: 'spin' }, title, sub, wheel, status, actions);
  const overlay = el('div', { class: 'spin-overlay' }, panel);

  let spinning = false;
  let settled = false;

  const reduced = (() => {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();

  function showError(outcome) {
    status.textContent = t(`reward.${outcome?.status ?? 'error'}.msg`);
    status.classList.add('is-error');
    actions.replaceChildren(
      button(t('common.retry'), { onClick: () => start(true), 'data-act': 'retry' }),
      button(t('common.close'), {
        variant: 'ghost',
        onClick: () => onDone?.(outcome),
        'data-act': 'close',
      }),
    );
  }

  function showPrize(outcome) {
    settled = true;
    status.classList.remove('is-error');
    status.replaceChildren(
      el('p', { class: 'spin__won', text: t('reward.awarded.title') }),
      el('p', { class: 'spin__prize', text: outcome.prize.label }),
      outcome.code
        ? el(
            'div',
            { class: 'spin__code' },
            el('code', { class: 'spin__code-value', text: outcome.code }),
            button(t('spin.copy'), {
              variant: 'ghost',
              size: 'sm',
              onClick: async (e) => {
                const btn = /** @type {HTMLElement} */ (e.currentTarget ?? e.target);
                try {
                  await navigator.clipboard.writeText(outcome.code);
                  btn.textContent = t('spin.copied');
                } catch {
                  /* Clipboard can be blocked (insecure context, permission).
                     Select the code instead so it can still be copied by hand —
                     never leave the player with no route to their own coupon. */
                  const range = document.createRange();
                  range.selectNodeContents(status.querySelector('.spin__code-value'));
                  const sel = getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                  btn.textContent = t('spin.copyManual');
                }
              },
            }),
          )
        : null,
      el('p', { class: 'spin__hint', text: t('reward.savedHint') }),
    );

    actions.replaceChildren(
      button(t('reward.viewWallet'), { onClick: () => onWallet?.(outcome), 'data-act': 'wallet' }),
      button(t('common.close'), {
        variant: 'ghost',
        onClick: () => onDone?.(outcome),
        'data-act': 'close',
      }),
    );
  }

  /** Denied but not faulted — survived, just not eligible to be paid out. */
  function showDenial(outcome) {
    settled = true;
    status.textContent = t(`reward.${outcome.status}.msg`);
    const pts = outcome.orderPoints;
    const need = outcome.pointsThreshold;
    if (Number.isFinite(pts) && Number.isFinite(need)) {
      status.append(el('p', { class: 'spin__points', text: `${num(pts)} / ${num(need)}` }));
    }

    /* A player who simply has not signed in gets the action that actually
       fixes it. Offering "try again" here would be a lie: the same round
       submitted again is denied for the same reason. */
    const acts =
      outcome.status === REWARD_STATUS_NOT_SIGNED_IN
        ? [
            button(t('reward.not_signed_in.cta'), {
              onClick: () => onSignIn?.(outcome),
              'data-act': 'signin',
            }),
            button(t('common.close'), {
              variant: 'ghost',
              onClick: () => onDone?.(outcome),
              'data-act': 'close',
            }),
          ]
        : [button(t('common.close'), { onClick: () => onDone?.(outcome), 'data-act': 'close' })];
    actions.replaceChildren(...acts);
  }

  async function start(isRetry = false) {
    if (spinning || settled) return;
    spinning = true;
    spinBtn.disabled = true;
    spinBtn.textContent = t('spin.spinning');
    status.classList.remove('is-error');
    status.textContent = t('spin.minting');
    if (isRetry) actions.replaceChildren(spinBtn);

    /* SERVER FIRST. Nothing spins until the outcome is known, so the animation
       can only ever reveal a decision that has already been made and recorded. */
    let outcome;
    try {
      outcome = await mintCoupon();
    } catch (err) {
      console.error('coupon minting failed', err);
      outcome = { status: 'error', awarded: false, prize: null, retryable: true };
    }

    spinning = false;

    if (!outcome || !outcome.awarded || !outcome.prize) {
      // No prize: never spin. A wheel that turns and lands on nothing reads as
      // a loss the player caused, when in fact they were simply not eligible.
      spinBtn.remove();
      if (outcome && DENIALS.has(outcome.status)) {
        showDenial(outcome);
      } else {
        showError(outcome);
      }
      return;
    }

    const index = Math.max(
      0,
      segments.findIndex((s) => s.key === outcome.prize.key),
    );
    const deg = rotationForIndex(index, count);

    status.textContent = t('spin.spinning');

    if (reduced) {
      // No spin under reduced motion — snap to the result and announce it.
      disc.style.transition = 'none';
      disc.style.transform = `rotate(${deg % 360}deg)`;
      disc.style.setProperty('--disc-rot', `${deg % 360}deg`);
      disc.classList.add('is-settled');
      showPrize(outcome);
      return;
    }

    disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.16,1)`;
    // Next frame, so the transition is applied to a committed starting value.
    requestAnimationFrame(() => {
      disc.style.transform = `rotate(${deg}deg)`;
    });

    const reveal = () => {
      // Labels must be readable at rest, so cancel the disc's resting angle.
      disc.style.setProperty('--disc-rot', `${deg % 360}deg`);
      disc.classList.add('is-settled');
      try {
        window.Sound?.reward?.();
      } catch {
        /* audio is non-critical */
      }
      showPrize(outcome);
    };
    disc.addEventListener('transitionend', reveal, { once: true });
    // Belt and braces: a dropped transitionend (backgrounded tab) must not
    // strand the player on a spinning wheel with their prize unclaimed.
    setTimeout(() => {
      if (!settled) reveal();
    }, SPIN_MS + SETTLE_MS);
  }

  return overlay;
}
