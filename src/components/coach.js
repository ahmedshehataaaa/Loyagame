/* ============================================================
   How-to-play coach card.

   An OVERLAY on the play screen, not a screen of its own — deliberately.
   A dedicated tutorial route is a screen players tap past to get to the
   game, so the instruction arrives when it is least wanted and is gone
   when it would help. Shown over the first round instead, it sits next to
   the thing it describes.

   Shown once per device, and always reachable again from the welcome
   screen, so it is never a wall and never lost.
   ============================================================ */
import { el, button } from './ui.js';
import { icon } from './icons.js';
import { t, num } from '../core/i18n.js';
import { roundSeconds, startLives } from '../core/rules.js';
import { hazardRule } from '../campaign/brand-copy.js';

const SEEN_KEY = 'mcslice.coached.v1';

export function hasSeenCoach() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Storage disabled — show it every time rather than never.
    return false;
  }
}

export function markCoachSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* nothing to do */
  }
}

const rule = (name, text) =>
  el(
    'li',
    { class: 'coach__rule' },
    el('span', { class: 'coach__glyph', 'aria-hidden': 'true' }, icon(name, { size: 26 })),
    el('span', { text }),
  );

/**
 * @param {{onStart:()=>void, dismissible?:boolean}} opts
 * @returns {HTMLElement}
 */
export function coachCard({ onStart, dismissible = true }) {
  // Live reads: the coach card must teach the rules of the RUNNING campaign.
  const seconds = roundSeconds();
  const lives = startLives();
  const hazard = hazardRule(num(lives));

  const panel = el(
    'div',
    { class: 'coach__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('howTo.title') },
    el('h2', { class: 'coach__title', text: t('howTo.title') }),

    el(
      'ul',
      { class: 'coach__rules' },
      // Order matters: what to do, what kills you, how you win, what you get.
      rule('blade', t('howTo.slice')),
      rule(hazard.icon, hazard.text),
      rule('clock', t('howTo.survive', { seconds })),
      rule('gift', t('howTo.reward')),
    ),

    button(t('howTo.start'), {
      onClick: () => {
        markCoachSeen();
        onStart();
      },
    }),
  );

  const overlay = el('div', { class: 'coach' }, panel);
  if (dismissible) {
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      markCoachSeen();
      onStart();
    });
  }
  return overlay;
}
