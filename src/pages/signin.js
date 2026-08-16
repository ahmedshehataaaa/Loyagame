/* Sign In — minimal phone capture.
   No OTP, no validation. Player enters their number, it is stored in
   localStorage via Store.signIn(), and they go straight to the game.
   If a number is already stored the page skips itself immediately. */
import { el, button } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { setIdentity } from '../services/loyalty.js';
import { track, EVENTS } from '../analytics/index.js';

export function SignInPage(root) {
  // Already have a number — skip straight to the game.
  if (Store.isSignedIn()) {
    navigate('/play', { replace: true });
    return;
  }

  const input = el('input', {
    class: 'signin__phone-input',
    type: 'tel',
    inputmode: 'numeric',
    placeholder: '05XXXXXXXX',
    maxlength: '15',
    autocomplete: 'tel-national',
    autofocus: true,
  });

  const playBtn = button('Play', {
    type: 'submit',
    disabled: true,
    'data-act': 'play',
  });

  input.addEventListener('input', () => {
    playBtn.disabled = input.value.trim().length === 0;
  });

  function submit() {
    const num = input.value.trim();
    if (!num) { input.focus(); return; }
    setIdentity('', num);
    Store.signIn({ name: `Player ${num.slice(-4)}`, isGuest: false, avatar: 'assets/avatar.png' });
    track(EVENTS.VERIFICATION_COMPLETED, { method: 'phone_direct', accepted: true });
    navigate('/play');
  }

  const form = el('form', { class: 'signin__card card', novalidate: true },
    el('img', { src: 'assets/brand-logo.png', alt: "McDonald's", class: 'signin__hub-logo' }),
    el('h1', { class: 'signin__title', text: "Enter your number to play" }),
    el('p', { class: 'signin__sub', text: "No code needed — just enter and go!" }),
    input,
    playBtn,
  );

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  root.append(
    el('div', { class: 'screen bg-burst signin' }, form),
  );
}
