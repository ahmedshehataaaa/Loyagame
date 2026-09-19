/* ============================================================
   Result — ONE screen for both outcomes.

   Replaces the split where a win was a route (`/win`) and a loss was a
   modal on the play screen. The player needs the same four facts either
   way — what they scored, whether it beat their best, what happened to
   their reward, and what to do next — so two layouts meant two things to
   keep consistent, and they already had drifted. Win and loss differ here
   by headline, colour and primary action, not by structure.

   Figures come from the recorded run; the reward comes from the server via
   rewardPanel. This screen never decides either.
   ============================================================ */
import { el, button, emptyState } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { rewardPanel } from '../components/reward-panel.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { t, num } from '../core/i18n.js';
import { roundSeconds, startLives } from '../core/rules.js';

export function ResultPage(root) {
  // Read at render time so a campaign manifest reaches this screen too.
  const ROUND_TIME = roundSeconds();
  const START_LIVES = startLives();
  const run = Store.progress().lastRun;

  // Reached directly (refresh / deep link) with no completed round.
  if (!run) {
    root.append(
      el(
        'div',
        { class: 'screen bg-burst' },
        emptyState(
          icon('gamepad', { size: 40 }),
          t('result.empty'),
          t('result.emptyBody'),
          el(
            'div',
            { style: { marginTop: '14px', width: '220px' } },
            button(t('common.playNow'), { onClick: () => navigate('/play') }),
          ),
        ),
      ),
    );
    return;
  }

  const won = !!run.won;
  const profile = Store.profile();
  const reduced = Store.settings().reducedMotion;

  /* Confetti only on a win, only when motion is allowed, and only as a
     decorative layer — it must never sit over the numbers the player came to
     read. Capped at 34 pieces: the brief asks for controlled celebration, not
     a screen the player has to wait out. */
  const confetti = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  if (won && !reduced) {
    // Brand tokens, so a tenant's confetti is its own colours, not McDonald's gold.
    const colors = ['var(--c-secondary)', '#ffffff', 'var(--c-secondary-hot)', 'var(--c-secondary-hi)'];
    for (let i = 0; i < 34; i++) {
      confetti.append(
        el('i', {
          style: {
            left: `${Math.random() * 100}%`,
            background: colors[(Math.random() * colors.length) | 0],
            animationDelay: `${-Math.random() * 3}s`,
            animationDuration: `${2.4 + Math.random() * 2}s`,
          },
        }),
      );
    }
  }

  const head = el(
    'div',
    { class: 'victory__head' },
    el('h1', {
      class: 't-display victory__title',
      text: won ? t('result.wonTitle') : t('result.lostTitle'),
    }),
    el('p', {
      class: 't-muted',
      text: won
        ? t('result.wonSub', { name: profile?.name ?? '' })
        : t('result.lostSub', { lives: num(START_LIVES) }),
    }),
    !won && el('p', { class: 't-muted', text: t('result.lostHint', { seconds: ROUND_TIME }) }),
  );

  const card = el(
    'section',
    { class: 'card victory__card' },
    el('span', { class: 't-kicker', text: t('result.finalScore') }),
    el('b', { class: 'victory__score', text: num(run.score) }),
    run.isBest &&
      el(
        'span',
        { class: 'victory__badge' },
        icon('trophy', { size: 16 }),
        el('span', { text: t('result.newBest') }),
      ),

    el(
      'div',
      { class: 'victory__grid' },
      el(
        'div',
        { class: 'victory__cell' },
        el('b', { text: num(run.itemsSliced) }),
        el('small', { text: t('result.slices') }),
      ),
      el(
        'div',
        { class: 'victory__cell' },
        el('b', { text: num(Store.progress().bestScore) }),
        el('small', { text: t('result.best') }),
      ),
      el(
        'div',
        { class: 'victory__cell' },
        el('b', { text: num(Store.progress().rewardPoints) }),
        el('small', { text: t('reward.pointsLabel') }),
      ),
    ),
  );

  const actions = el(
    'div',
    { class: 'victory__actions' },
    button(t('common.playAgain'), {
      icon: icon('play', { size: 15 }),
      onClick: () => navigate('/play'),
    }),
    button(t('common.wallet'), { variant: 'ghost', onClick: () => navigate('/wallet') }),
    el(
      'div',
      { class: 'welcome__links' },
      button(t('common.leaderboard'), {
        variant: 'ghost',
        size: 'sm',
        onClick: () => navigate('/leaderboard'),
      }),
      button(t('common.home'), { variant: 'ghost', size: 'sm', onClick: () => navigate('/') }),
    ),
  );

  root.append(
    el(
      'div',
      { class: `screen bg-burst victory result--${won ? 'won' : 'lost'}` },
      confetti,
      head,
      card,
      // Whatever the server decided. Renders nothing if no round was submitted.
      rewardPanel(Store.lastReward(), { onWallet: () => navigate('/wallet') }),
      actions,
    ),
  );
}
