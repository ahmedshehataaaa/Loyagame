/* Sign In — two steps, matching 02_signin_screen.png: enter a number, then
   enter the code that number receives.

   THE NUMBER IS VERIFIED NOW. It previously was not: the button said "Continue"
   precisely because "Send Code" had promised a verification step that did not
   exist, and the honest thing at the time was to stop promising it. The step
   exists now — `/send-otp` and `/verify-otp` — so the reference's "Send Code"
   is truthful again, and `setIdentity()` runs only after the SERVER reports
   `verified: true`.

   Nothing here knows the correct code, and nothing here decides whether
   verification passed. A check the browser can answer is a check an attacker
   can answer — the same rule that governs the reward path. */
import { el, button, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { register, clearIdentity, sendOtp, verifyOtp } from '../services/loyalty.js';
import { t } from '../core/i18n.js';
import { track, EVENTS } from '../analytics/index.js';
import { brandLogo, brandSlogan } from '../campaign/brand-copy.js';

const RESEND_COOLDOWN_SEC = 30;

const CODES = ['+20', '+1', '+44', '+62', '+971', '+966'];

/** Digits only, 6–13 long — matches the engine's old phone rule. */
function validate(cc, digits) {
  if (!digits) return t('signin.errEmpty');
  if (!/^\d+$/.test(digits)) return t('signin.errDigits');
  if (digits.length < 6) return t('signin.errShort');
  if (digits.length > 13) return t('signin.errLong');
  if (!cc) return t('signin.errCode');
  return null;
}

export function SignInPage(root) {
  let submitting = false;
  // `method` records the PATH taken, never the number itself.

  const ccSel = el(
    'select',
    { class: 'field__input field__cc', id: 'cc', 'aria-label': 'Country code' },
    ...CODES.map((c) => el('option', { value: c, text: c })),
  );

  const input = el('input', {
    class: 'field__input',
    id: 'phone',
    type: 'tel',
    inputmode: 'numeric',
    autocomplete: 'tel-national',
    placeholder: '812 3456 7890',
    'aria-describedby': 'phone-err',
  });

  const err = el('small', { class: 'field__error', id: 'phone-err', role: 'alert' });
  // Truthful again: pressing this really does send a code.
  const submit = button(t('signin.sendCode'), {
    type: 'submit',
    'data-act': 'send-code',
    disabled: true,
  });

  function setError(msg) {
    err.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* The CTA reflects whether it can actually do anything. It starts inert and
     only lights up once the number would pass `validate()` — the same check the
     submit handler runs, so the button can never promise a send the handler
     then refuses. Silent while typing: no error is shown for a number that is
     merely unfinished, the button simply has not lit yet. */
  function syncSubmitState() {
    if (submitting) return;
    const digits = input.value.replace(/\D/g, '');
    const ready = validate(ccSel.value, digits) === null;
    submit.disabled = !ready;
    submit.classList.toggle('btn--glow', ready);
  }

  input.addEventListener('input', () => {
    if (err.textContent) setError(null);
    syncSubmitState();
  });
  ccSel.addEventListener('change', syncSubmitState);

  const form = el(
    'form',
    { class: 'signin__card card', novalidate: true },
    el('h1', { class: 'signin__title', text: t('signin.title') }),
    el('p', { class: 'signin__sub', text: t('signin.sub') }),

    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'phone', text: t('signin.label') }),
      el('div', { class: 'field__row' }, ccSel, input),
      err,
    ),

    submit,

    el('p', { class: 'signin__legal' }, t('signin.legal')),

    el('p', { class: 'signin__legal', text: t('signin.unverified') }),

    el(
      'div',
      { class: 'signin__alt' },
      button(t('signin.guest'), {
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          // A guest has no number for the server to attribute a prize to, so
          // clear any stored identity: guest rounds must be practice rounds,
          // not rounds silently credited to a previous player on this device.
          clearIdentity();
          track(EVENTS.VERIFICATION_COMPLETED, { method: 'guest', accepted: true });
          Store.signIn({ name: 'Guest Slicer', isGuest: true, avatar: 'assets/avatar.png' });
          toast(t('signin.guestNote'), 'ok');
          navigate('/play');
        },
      }),
    ),
  );

  /* ---- Step 2: the code -----------------------------------------------
     Swapped into the same card rather than pushed as a route, so Back still
     means "leave sign-in" and a reload cannot strand a player on a code screen
     waiting for a code that is no longer valid. */
  function showCodeStep(cc, digits) {
    const codeInput = el('input', {
      class: 'field__input field__input--code',
      id: 'otp',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      maxlength: '6',
      placeholder: '● ● ● ● ● ●',
      'aria-describedby': 'otp-err',
    });
    const codeErr = el('small', { class: 'field__error', id: 'otp-err', role: 'alert' });
    const verifyBtn = button(t('signin.verify'), { type: 'submit', 'data-act': 'verify' });
    const resendBtn = button(t('signin.resend'), {
      variant: 'ghost',
      size: 'sm',
      'data-act': 'resend',
    });

    let cooling = 0;
    const tick = () => {
      if (cooling <= 0) {
        resendBtn.disabled = false;
        resendBtn.textContent = t('signin.resend');
        return;
      }
      resendBtn.disabled = true;
      resendBtn.textContent = t('signin.resendIn', { sec: cooling });
      cooling -= 1;
      setTimeout(tick, 1000);
    };
    const startCooldown = () => {
      cooling = RESEND_COOLDOWN_SEC;
      tick();
    };

    const setCodeError = (msg) => {
      codeErr.textContent = msg || '';
      codeInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    codeInput.addEventListener('input', () => {
      // Digits only, so a pasted "123 456" still verifies.
      const cleaned = codeInput.value.replace(/\D/g, '').slice(0, 6);
      if (cleaned !== codeInput.value) codeInput.value = cleaned;
      if (codeErr.textContent) setCodeError(null);
    });

    let checking = false;
    const codeForm = el(
      'form',
      { class: 'signin__card card', novalidate: true },
      el('h1', { class: 'signin__title', text: t('signin.codeTitle') }),
      el('p', { class: 'signin__sub', text: t('signin.codeSub', { phone: `${cc} ${digits}` }) }),
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field__label', for: 'otp', text: t('signin.codeLabel') }),
        codeInput,
        codeErr,
      ),
      verifyBtn,
      el('div', { class: 'signin__alt' }, resendBtn),
      el(
        'div',
        { class: 'signin__alt' },
        button(t('signin.changeNumber'), {
          variant: 'ghost',
          size: 'sm',
          'data-act': 'change-number',
          onClick: () => {
            codeForm.replaceWith(form);
            submit.textContent = t('signin.sendCode');
            // Re-derive rather than force-enable: the number in the field is
            // the only thing that may decide whether this button is live.
            syncSubmitState();
          },
        }),
      ),
    );

    resendBtn.addEventListener('click', async () => {
      setCodeError(null);
      const res = await sendOtp({ cc, phone: digits });
      if (res.ok) {
        toast(t('signin.codeSent'), 'ok');
        startCooldown();
      } else if (res.kind === 'rate_limited') {
        setCodeError(t('signin.errTooSoon'));
        startCooldown();
      } else {
        setCodeError(t('signin.errSendFailed'));
      }
    });

    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (checking) return;
      const code = codeInput.value.replace(/\D/g, '');
      if (code.length !== 6) {
        setCodeError(t('signin.errCodeLen'));
        codeInput.focus();
        return;
      }

      checking = true;
      verifyBtn.disabled = true;
      verifyBtn.textContent = t('signin.verifying');

      const res = await verifyOtp({ cc, phone: digits, code });

      checking = false;
      verifyBtn.disabled = false;
      verifyBtn.textContent = t('signin.verify');

      /* The SERVER decides. `verifyOtp` stores the identity only on a genuine
         `verified: true`, so no error shape here can sign anyone in. */
      if (res.ok && res.data?.verified === true) {
        Store.signIn({
          name: `Player ${digits.slice(-4)}`,
          isGuest: false,
          avatar: 'assets/avatar.png',
        });
        const pts = res.data?.profile?.orderPoints;
        if (Number.isFinite(pts)) Store.setOrderPoints(pts);
        track(EVENTS.VERIFICATION_COMPLETED, { method: 'phone_otp', accepted: true });
        toast(t('signin.verified'), 'ok');
        navigate('/play');
        return;
      }

      track(EVENTS.VERIFICATION_COMPLETED, { method: 'phone_otp', accepted: false });
      const detail = res.ok ? res.data?.error : res.detail;
      const left = res.ok ? res.data?.attemptsLeft : res.body?.attemptsLeft;
      if (detail === 'code_expired') setCodeError(t('signin.errCodeExpired'));
      else if (detail === 'too_many_attempts' || res.kind === 'rate_limited')
        setCodeError(t('signin.errCodeMany'));
      else if (Number.isFinite(left)) setCodeError(t('signin.errCodeWrong', { left }));
      // Never guess the count: "0 tries left" next to a working input is worse
      // than not saying, and that is exactly what a missing value produced.
      else setCodeError(t('signin.errCodeWrongPlain'));
      codeInput.select();
    });

    form.replaceWith(codeForm);
    startCooldown();
    codeInput.focus();
  }

  // Reflect the initial (empty) state before the player touches anything.
  syncSubmitState();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting) return; // guard double submit

    const digits = input.value.replace(/\D/g, '');
    const problem = validate(ccSel.value, digits);
    if (problem) {
      setError(problem);
      input.focus();
      return;
    }

    submitting = true;
    submit.disabled = true;
    submit.textContent = t('signin.sending');

    /* Register so the player row exists, then ask for a code. Identity is NOT
       kept at this point — `register()` sets it, so it is cleared again here
       and only re-established by a verified `verifyOtp()`. A number nobody has
       proved they hold must never be able to collect a prize. */
    register({ cc: ccSel.value, phone: digits, consent: true })
      .then((reg) => {
        clearIdentity();
        if (!reg.ok && reg.kind === 'not_configured') {
          // Rewards switched off in this build: there is nothing to verify
          // against, so say "practice" rather than block the player entirely.
          Store.signIn({
            name: `Player ${digits.slice(-4)}`,
            isGuest: false,
            avatar: 'assets/avatar.png',
          });
          toast(t('signin.practice'), 'ok');
          navigate('/play');
          return null;
        }
        return sendOtp({ cc: ccSel.value, phone: digits });
      })
      .then((res) => {
        if (!res) return; // practice path already navigated
        if (res.ok) {
          track(EVENTS.VERIFICATION_STARTED, { method: 'phone_otp' });
          toast(t('signin.codeSent'), 'ok');
          showCodeStep(ccSel.value, digits);
        } else if (res.kind === 'rate_limited') {
          setError(t('signin.errTooSoon'));
        } else {
          setError(t('signin.errSendFailed'));
        }
      })
      .catch((error) => {
        console.error('send code failed', error);
        setError(t('signin.errSendFailed'));
      })
      .finally(() => {
        submitting = false;
        if (submit.textContent === t('signin.sending')) submit.textContent = t('signin.sendCode');
        syncSubmitState();
      });
  });

  root.append(
    el(
      'div',
      { class: 'screen bg-burst signin' },
      el(
        'header',
        { class: 'signin__brand' },
        el('img', { src: brandLogo().src, alt: brandLogo().alt, width: '86', height: '86' }),
        el('p', { class: 'welcome__slogan', text: brandSlogan() }),
      ),
      form,
      button(`← ${t('common.back')}`, {
        variant: 'ghost',
        size: 'sm',
        onClick: () => navigate('/'),
      }),
    ),
  );
}
