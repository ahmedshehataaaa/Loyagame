/* Sign In — Stitch "McSlice Rush - Ronald Sign In".
   A real form: a country-code + phone field, inline validation, a
   guarded submit, and a guest path. No backend auth exists for this
   build, so a verified number simply establishes a local player. */
import { el, button, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

const CODES = ['+20', '+1', '+44', '+62', '+971', '+966'];

/** Digits only, 6–13 long — matches the engine's old phone rule. */
function validate(cc, digits) {
  if (!digits) return 'Enter your mobile number.';
  if (!/^\d+$/.test(digits)) return 'Numbers only, please.';
  if (digits.length < 6) return 'That number looks too short.';
  if (digits.length > 13) return 'That number looks too long.';
  if (!cc) return 'Pick a country code.';
  return null;
}

export function SignInPage(root) {
  let submitting = false;

  const ccSel = el('select', { class: 'field__input field__cc', id: 'cc', 'aria-label': 'Country code' },
    ...CODES.map((c) => el('option', { value: c, text: c })));

  const input = el('input', {
    class: 'field__input', id: 'phone', type: 'tel', inputmode: 'numeric',
    autocomplete: 'tel-national', placeholder: '812 3456 7890',
    'aria-describedby': 'phone-err',
  });

  const err = el('small', { class: 'field__error', id: 'phone-err', role: 'alert' });
  const submit = button('Send Code', { type: 'submit' });

  function setError(msg) {
    err.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  input.addEventListener('input', () => { if (err.textContent) setError(null); });

  const form = el('form', { class: 'signin__card card', novalidate: true },
    el('h1', { class: 'signin__title', text: "Let's Play!" }),
    el('p', { class: 'signin__sub', text: 'Enter your number to join the rush' }),

    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'phone', text: 'Mobile number' }),
      el('div', { class: 'field__row' }, ccSel, input),
      err,
    ),

    submit,

    el('p', { class: 'signin__legal' },
      'By continuing you agree to the program terms. Your number is used only for this loyalty game.'),

    el('div', { class: 'signin__alt' },
      button('Continue as guest', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
          Store.signIn({ name: 'Guest Slicer', isGuest: true, avatar: 'assets/avatar.png' });
          toast('Playing as guest', 'ok');
          navigate('/play');
        },
      }),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting) return;                         // guard double submit

    const digits = input.value.replace(/\D/g, '');
    const problem = validate(ccSel.value, digits);
    if (problem) { setError(problem); input.focus(); return; }

    submitting = true;
    submit.disabled = true;
    submit.textContent = 'Signing in…';

    // Simulated round-trip: there is no auth backend in this build.
    setTimeout(() => {
      Store.signIn({
        name: `Player ${digits.slice(-4)}`,
        isGuest: false,
        avatar: 'assets/avatar.png',
      });
      submitting = false;
      toast('Signed in — go slice!', 'ok');
      navigate('/play');
    }, 550);
  });

  root.append(el('div', { class: 'screen bg-burst signin' },
    el('header', { class: 'signin__brand' },
      el('img', { src: 'assets/brand-logo.png', alt: "McDonald's", width: '86', height: '86' }),
      el('p', { class: 'welcome__slogan', text: "i'm lovin' it" }),
    ),
    form,
    button('← Back', { variant: 'ghost', size: 'sm', onClick: () => navigate('/') }),
  ));
}
