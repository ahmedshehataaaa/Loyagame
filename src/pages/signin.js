/* Sign In — minimal phone capture.
   No OTP, no validation. Player enters their number, it is stored in
   localStorage via Store.signIn(), and they go straight to the game.
   If a number is already stored the page skips itself immediately. */
import { el, button } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { setIdentity, getIdentity } from '../services/loyalty.js';
import { track, EVENTS } from '../analytics/index.js';
import { brandLogo } from '../campaign/brand-copy.js';

/* Dialling code paired with the local numbers this campaign captures. Matches
   normalizeLoosePhone() in lib/db.mjs, which maps POS numbers to +20 — the two
   MUST agree or a player's rounds and their orders resolve to different people.
   Change both together if this campaign ever runs outside Egypt. */
const COUNTRY_CODE = '+20';

export function SignInPage(root) {
  /* Already have a number — skip straight to the game. Both halves: a number
     the server refused has had its identity cleared (loyalty.startRound), and
     the player must land here to enter it again, not bounce back to /play. */
  if (Store.isSignedIn() && getIdentity()) {
    navigate('/play', { replace: true });
    return;
  }

  const input = el('input', {
    class: 'signin__phone-input',
    type: 'tel',
    inputmode: 'numeric',
    placeholder: '01XXXXXXXXX',
    maxlength: '15',
    autocomplete: 'tel-national',
    autofocus: true,
  });

  const playBtn = button('Play', {
    type: 'submit',
    disabled: true,
    'data-act': 'play',
  });

  const hint = el('p', { class: 'signin__sub', role: 'alert', hidden: true });

  input.addEventListener('input', () => {
    playBtn.disabled = input.value.trim().length === 0;
    hint.hidden = true;
  });

  function submit() {
    const num = input.value.trim();
    if (!num) {
      input.focus();
      return;
    }
    /* The country code is what makes this an E.164 identity, and it was empty.
       That is why no coupon could ever be minted: /start-run rejected every
       session with 400 invalid_phone (the backend requires a leading "+"), so
       the client never held a token and the round degraded to a practice round.
       In production the same empty code stored a number with no country prefix,
       which could never match the +20… identities normalizeLoosePhone() writes
       from the POS webhook, so order points would not have credited either.
       Numbers are entered in local 0-prefixed form; drop that zero, exactly as
       normalizeLoosePhone() does. */
    const local = num.replace(/\D/g, '').replace(/^0+/, '');
    /* An Egyptian mobile: 01X and eight more digits, so ten once the 0 is
       dropped. Anything else used to be stored anyway, and the server then
       refused every round with no way to correct the number. */
    if (!/^1[0125]\d{8}$/.test(local)) {
      hint.textContent = 'Enter your Egyptian mobile number, e.g. 01012345678.';
      hint.hidden = false;
      input.focus();
      return;
    }
    setIdentity(COUNTRY_CODE, local);
    Store.signIn({ name: `Player ${num.slice(-4)}`, isGuest: false, avatar: 'assets/avatar.png' });
    track(EVENTS.VERIFICATION_COMPLETED, { method: 'phone_direct', accepted: true });
    navigate('/play');
  }

  const form = el(
    'form',
    { class: 'signin__card card', novalidate: true },
    el('img', { src: brandLogo().src, alt: brandLogo().alt, class: 'signin__hub-logo' }),
    el('h1', { class: 'signin__title', text: 'Enter your number to play' }),
    el('p', { class: 'signin__sub', text: 'No code needed — just enter and go!' }),
    input,
    hint,
    playBtn,
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  root.append(el('div', { class: 'screen bg-burst signin' }, form));
}
