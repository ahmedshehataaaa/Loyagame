/* Welcome — Stitch "McSlice Rush - Ronald Welcome".
   Hero character art over a red sunburst, then the primary CTA. */
import { el, button, iconButton, tabbar, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

export function WelcomePage(root) {
  const signedIn = Store.isSignedIn();
  const { soundEnabled } = Store.settings();

  const soundBtn = iconButton(soundEnabled ? '🔊' : '🔇', 'Toggle sound', {
    plain: true,
    onClick: () => {
      const on = Store.toggleSound();
      soundBtn.querySelector('span').textContent = on ? '🔊' : '🔇';
      soundBtn.setAttribute('aria-pressed', String(on));
      toast(on ? 'Sound on' : 'Sound off');
    },
  });
  soundBtn.setAttribute('aria-pressed', String(soundEnabled));

  const screen = el(
    'div',
    { class: 'screen bg-burst welcome' },
    el(
      'div',
      { class: 'welcome__bar' },
      soundBtn,
      el('img', { class: 'welcome__arches', src: 'assets/brand-logo.png', alt: "McDonald's" }),
      iconButton(signedIn ? '👤' : '→', signedIn ? 'Your profile' : 'Sign in', {
        plain: true,
        onClick: () => navigate('/sign-in'),
      }),
    ),

    el('p', { class: 'welcome__slogan', text: "i'm lovin' it" }),

    el(
      'div',
      { class: 'welcome__hero' },
      el('img', {
        src: 'assets/mascot.png',
        alt: '',
        'aria-hidden': 'true',
        class: 'welcome__mascot',
        width: '260',
        height: '260',
        onError: (e) => {
          e.target.style.display = 'none';
        },
      }),
    ),

    el(
      'div',
      { class: 'welcome__copy' },
      el('h1', { class: 't-display', html: 'Welcome to<br>McSlice Rush!' }),
      el('p', { class: 'welcome__sub', text: 'Slice your way to real rewards' }),
      signedIn &&
        el('p', { class: 'welcome__greet', text: `Back for more, ${Store.profile().name}?` }),
    ),

    el(
      'div',
      { class: 'welcome__cta' },
      button(signedIn ? 'Play Now' : 'Play Now', {
        icon: '▶',
        onClick: () => navigate(signedIn ? '/play' : '/sign-in'),
      }),
      el(
        'div',
        { class: 'welcome__links' },
        button('Rewards', { variant: 'ghost', size: 'sm', onClick: () => navigate('/rewards') }),
        button('Leaderboard', {
          variant: 'ghost',
          size: 'sm',
          onClick: () => navigate('/leaderboard'),
        }),
      ),
    ),
  );

  root.append(screen, tabbar('/'));
}
