/* ============================================================
   Welcome — campaign entry.

   This is the first thing a player sees after scanning the code, so it has
   to answer four questions before the tap: what the game is, how you lose,
   how long a round takes, and what you can win. It previously answered
   none of them — it showed a tagline over the Pasta & Heat rooster-"P"
   mascot inherited from a different restaurant's build, with roughly 45%
   of the viewport empty flat red between logo and copy.

   The hero is now composed from the real McDonald's item sprites the game
   actually throws, with a slice stroke through the middle. That fixes the
   branding with assets this build owns rather than waiting on new art, and
   it doubles as a preview of the gameplay.
   ============================================================ */
import { el, button, iconButton, tabbar, toast } from '../components/ui.js';
import { icon, setIcon } from '../components/icons.js';
import { coachCard, markCoachSeen } from '../components/coach.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { t, toggleLang } from '../core/i18n.js';
import { roundSeconds } from '../core/rules.js';

/* The airborne items, as [sprite, class] pairs. Positioned in CSS so the
   composition survives a locale/direction flip without JS. */
const HERO_ITEMS = [
  ['assets/items/bigmac.png', 'is-hero'],
  ['assets/items/fries.png', 'is-left'],
  ['assets/items/mcflurry.png', 'is-right'],
  ['assets/items/nuggets.png', 'is-low'],
];

function heroArt() {
  const stage = el('div', { class: 'hero', 'aria-hidden': 'true' });
  for (const [src, cls] of HERO_ITEMS) {
    stage.append(
      el('img', {
        class: `hero__item ${cls}`,
        src,
        alt: '',
        loading: 'eager',
        decoding: 'async',
        onError: (e) => {
          // Missing art must not leave a broken-image glyph in the hero.
          e.target.style.display = 'none';
        },
      }),
    );
  }
  // The slice: a single diagonal stroke, drawn not imaged.
  stage.append(el('span', { class: 'hero__slash' }));
  return stage;
}

export function WelcomePage(root) {
  const ROUND_TIME = roundSeconds();
  const signedIn = Store.isSignedIn();
  const { soundEnabled } = Store.settings();

  const soundBtn = iconButton(
    icon(soundEnabled ? 'soundOn' : 'soundOff'),
    t('common.toggleSound'),
    {
      plain: true,
      onClick: () => {
        const on = Store.toggleSound();
        setIcon(soundBtn.querySelector('span'), on ? 'soundOn' : 'soundOff');
        soundBtn.setAttribute('aria-pressed', String(on));
        toast(on ? t('common.soundOn') : t('common.soundOff'));
      },
    },
  );
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));

  const screen = el(
    'div',
    { class: 'screen bg-burst welcome' },

    el(
      'div',
      { class: 'welcome__bar' },
      soundBtn,
      el('img', {
        class: 'welcome__arches',
        src: 'assets/brand-logo.png',
        alt: "McDonald's",
        width: '52',
        height: '52',
      }),
      // Language is a first-class control, not a buried setting: an Arabic
      // speaker should not have to read English to find it.
      button(t('lang.switch'), {
        variant: 'ghost',
        size: 'sm',
        'data-act': 'lang',
        onClick: () => toggleLang(),
      }),
    ),

    el('p', { class: 'welcome__slogan', text: t('welcome.slogan') }),

    heroArt(),

    el(
      'div',
      { class: 'welcome__copy' },
      el('h1', { class: 't-display', html: t('welcome.title') }),
      el('p', { class: 'welcome__sub', text: t('welcome.sub', { seconds: ROUND_TIME }) }),
      el('p', { class: 'welcome__prize', text: t('welcome.prizeTeaser') }),
      signedIn &&
        el('p', {
          class: 'welcome__greet',
          text: t('welcome.greet', { name: Store.profile().name }),
        }),
    ),

    el(
      'div',
      { class: 'welcome__cta' },
      /* The one action this screen exists for, so it carries the attention
         treatment and nothing else on the screen does. */
      button(t('common.playNow'), {
        icon: icon('play', { size: 17 }),
        glow: true,
        onClick: () => navigate(signedIn ? '/play' : '/sign-in'),
      }),
      // Low-noise reassurance, directly under the CTA where hesitation happens.
      el('p', { class: 'welcome__trust', text: t('welcome.trust', { seconds: ROUND_TIME }) }),
      el(
        'div',
        { class: 'welcome__links' },
        button(t('welcome.howTo'), {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            // Always available, so the coach card is never lost after first run.
            const card = coachCard({
              onStart: () => {
                card.remove();
                markCoachSeen();
              },
            });
            screen.append(card);
          },
        }),
        button(t('common.wallet'), {
          variant: 'ghost',
          size: 'sm',
          onClick: () => navigate('/wallet'),
        }),
        button(t('common.leaderboard'), {
          variant: 'ghost',
          size: 'sm',
          onClick: () => navigate('/leaderboard'),
        }),
      ),
      /* A text link, not a button. Terms is a legal reference rather than a
         call to action, and as a full button row it cost 48px — enough to push
         the CTA below the fold at 320x568. It must stay reachable at EVERY
         size, so shrinking it was the right trade; hiding it was not. */
      el(
        'div',
        { class: 'welcome__legal' },
        el('a', {
          class: 'text-link',
          href: '#/terms',
          text: t('common.terms'),
        }),
      ),
    ),
  );

  root.append(screen, tabbar('/'));
}
