/* ============================================================
   Internationalisation — English + Arabic with RTL.

   The pre-refactor build had EN/AR (`_legacy-ui-backup/i18n.js`) and the
   `src/` rewrite dropped it entirely, so Arabic support regressed to
   nothing. This restores it as a first-class concern rather than a
   translation layer bolted on later.

   Deliberately tiny and dependency-free: a flat key map per locale, a
   `t()` lookup with `{placeholder}` interpolation, and a document-level
   `dir` switch. No pluralisation engine — the copy is written to avoid
   needing one, which is cheaper than carrying an ICU parser for a game
   with a few dozen strings.

   Keys are namespaced by screen (`result.title`) so a missing one is
   obvious in place. A missing key renders the key itself, never blank:
   silence is harder to notice than a visible `result.title`.
   ============================================================ */

const STORE_KEY = 'mcslice.lang.v1';

/** @typedef {'en'|'ar'} Lang */

const STRINGS = {
  en: {
    'lang.name': 'English',
    'lang.switch': 'العربية',

    'common.back': 'Back',
    'common.close': 'Close',
    'common.home': 'Home',
    'common.play': 'Play',
    'common.playNow': 'Play Now',
    'common.playAgain': 'Play Again',
    'common.rewards': 'Rewards',
    'common.wallet': 'My Rewards',
    'common.leaderboard': 'Leaderboard',
    'common.ranks': 'Ranks',
    'common.terms': 'Terms',
    'common.loading': 'Loading…',
    'common.retry': 'Try again',
    'common.soundOn': 'Sound on',
    'common.soundOff': 'Sound off',
    'common.toggleSound': 'Toggle sound',
    'common.orderPoints': 'Order points',
    'common.offline': "You're offline. Scores are saved; rewards need a connection.",

    'welcome.title': 'Slice the Menu,<br>Win Real Rewards',
    'welcome.sub': 'Last {seconds} seconds without slicing a burnt batch.',
    'welcome.greet': 'Back for more, {name}?',
    'welcome.slogan': "i'm lovin' it",
    'welcome.signIn': 'Sign in',
    'welcome.profile': 'Your profile',
    'welcome.howTo': 'How to play',
    'welcome.prizeTeaser': 'Prizes from Free Fries to a free Big Mac®',

    'howTo.title': 'How to play',
    'howTo.slice': 'Swipe across the food to slice it. Chain slices for combos.',
    'howTo.avoid': 'Never slice the burnt fries. {lives} of them ends your round.',
    'howTo.survive': 'Last the full {seconds} seconds to win the round.',
    'howTo.reward': 'Winning plus enough order points earns a real prize.',
    'howTo.start': 'Got it — play',

    'signin.title': "Let's Play!",
    'signin.sub': 'Enter your number to join the rush',
    'signin.label': 'Mobile number',
    'signin.continue': 'Continue',
    'signin.sendCode': 'Send Code',
    'signin.sending': 'Sending…',
    'signin.codeTitle': 'Enter your code',
    'signin.codeSub': 'We sent a 6-digit code to {phone}',
    'signin.codeLabel': '6-digit code',
    'signin.verify': 'Verify',
    'signin.verifying': 'Checking…',
    'signin.resend': 'Resend code',
    'signin.resendIn': 'Resend in {sec}s',
    'signin.codeSent': 'Code sent — check your messages',
    'signin.errCodeLen': 'Enter the 6 digits from your message.',
    'signin.errCodeWrong': 'That code is not right. {left} tries left.',
    'signin.errCodeWrongPlain': 'That code is not right.',
    'signin.errCodeExpired': 'That code expired. Send a new one.',
    'signin.errCodeMany': 'Too many tries. Send a new code.',
    'signin.errSendFailed': "Couldn't send a code. Try again.",
    'signin.errTooSoon': 'Hold on a moment before asking for another code.',
    'signin.verified': 'Number verified — go slice!',
    'signin.changeNumber': 'Use a different number',
    'signin.signingIn': 'Signing in…',
    'signin.guest': 'Continue as guest',
    'signin.guestNote': 'Playing as guest — practice only, no prizes',
    'signin.legal':
      'By continuing you agree to the program terms. Your number is used only for this loyalty game.',
    'signin.unverified': "We'll text you a 6-digit code to confirm it's you.",
    'signin.errEmpty': 'Enter your mobile number.',
    'signin.errDigits': 'Numbers only, please.',
    'signin.errShort': 'That number looks too short.',
    'signin.errLong': 'That number looks too long.',
    'signin.errCode': 'Pick a country code.',
    'signin.ok': 'Signed in — go slice!',
    'signin.practice': 'Signed in — practice mode, no prizes',
    'signin.noRewards': "Signed in — couldn't reach rewards, practice only",

    'play.survive': 'SURVIVE {seconds}s',
    'play.score': 'SCORE',
    'play.time': 'TIME',
    'play.hint': 'Swipe across the food to slice it — avoid the burnt fries!',
    'play.pause': 'Pause game',
    'play.paused': 'Paused',
    'play.pausedBody': 'Take a breath. Your round is waiting.',
    'play.resume': 'Resume',
    'play.restart': 'Restart',
    'play.quit': 'Quit to home',
    'play.stakePrize': 'Prize round — last the full round to win.',
    'play.stakeNoIdentity': 'Practice round — sign in with your number to play for prizes.',
    'play.stakeLocked': 'Practice round — you already won recently.',
    'play.stakeOff': 'Practice round — rewards are off in this build.',
    'play.stakeUnreachable': "Practice round — couldn't reach the rewards service.",
    'play.stakeIneligible': 'Practice round — this round is not eligible for a prize.',
    'play.failed': 'Game failed to start',

    'result.wonTitle': 'You survived!',
    'result.lostTitle': 'Burnt out!',
    'result.wonSub': 'Great slicing, {name}',
    'result.lostSub': 'You hit {lives} burnt batches.',
    'result.lostHint': 'Last the full {seconds} seconds to win the round.',
    'result.finalScore': 'Final score',
    'result.newBest': 'NEW PERSONAL BEST',
    'result.slices': 'SLICES',
    'result.best': 'YOUR BEST',
    'result.empty': 'No round to show',
    'result.emptyBody': 'Play a round first — your result will land here.',

    'reward.label': 'REWARD',
    'reward.yours': 'YOUR PRIZE',
    'reward.savedHint': 'Saved to My Rewards. Show it at the counter to claim.',
    'reward.pointsLabel': 'ORDER POINTS',
    'reward.pointsShort': '{short} more to unlock a prize — earned by ordering.',
    'reward.pointsEnough': 'Enough for a prize.',
    'reward.checkAgain': 'Check again',
    'reward.viewWallet': 'View My Rewards',

    'spin.title': 'SPIN TO WIN',
    'spin.sub': 'Your next delicious reward is just one spin away.',
    'spin.cta': 'SPIN NOW',
    'spin.spinning': 'Spinning…',
    'spin.minting': 'Checking your reward…',
    'spin.copy': 'Copy code',
    'spin.copied': 'Copied!',
    'spin.copyManual': 'Selected — copy it',

    'reward.awarded.title': 'You won!',
    'reward.not_eligible.title': 'Round survived!',
    'reward.not_eligible.msg':
      'You need more order points before you can claim a prize. Points come from ordering.',
    'reward.eliminated.title': 'Burnt out!',
    'reward.eliminated.msg':
      'You hit too many burnt batches. Last the full round to be in for a prize.',
    'reward.pending.title': 'Reward on its way',
    'reward.pending.msg':
      "We couldn't reach the rewards service. Your round is saved — check My Rewards shortly.",
    'reward.not_signed_in.title': 'Practice round',
    'reward.not_signed_in.msg':
      'Sign in with your number to play for a real prize. Your score still counts.',
    'reward.not_signed_in.cta': 'Sign in to win',
    'reward.unavailable.title': 'Practice round',
    'reward.unavailable.msg':
      'Rewards are switched off in this build. Your score still counts locally.',
    'reward.session_expired.title': 'Round expired',
    'reward.session_expired.msg':
      'This round took too long to submit. Play another to be in for a prize.',
    'reward.rate_limited.title': 'Slow down a moment',
    'reward.rate_limited.msg': 'Too many rounds too quickly. Try again in a little while.',
    'reward.flagged.title': 'Round under review',
    'reward.flagged.msg': 'This round needs a manual check before any prize is issued.',
    'reward.error.title': 'Something went wrong',
    'reward.error.msg': "We couldn't confirm a prize for this round. No prize has been issued.",

    'wallet.title': 'My Rewards',
    'wallet.empty': 'No rewards yet',
    'wallet.emptyBody': 'Survive a round with enough order points and your prize lands here.',
    'wallet.redeemed': 'REDEEMED',
    'wallet.active': 'READY',
    'wallet.showStaff': 'Show this screen to staff to redeem. One use only.',
    'wallet.expires': 'Expires {date}',
    'wallet.noExpiry': 'No expiry set',
    'wallet.counterOnly': 'Redeeming at the counter only — not available in-app yet.',
    'wallet.serverNote': 'Your prize history lives on our servers and needs a connection to load.',

    'terms.title': 'Terms & eligibility',
    'terms.intro': 'Plain-language summary of how this game and its rewards work.',
    'terms.eligibilityH': 'Who can play',
    'terms.eligibilityB':
      'Anyone can play practice rounds. Playing for a prize needs a mobile number, which is used only to attribute your rounds and prizes.',
    'terms.rulesH': 'How a round works',
    'terms.rulesB':
      'A round lasts {seconds} seconds. Slicing {lives} burnt batches ends it. You win by lasting the full round.',
    'terms.prizeH': 'How prizes work',
    'terms.prizeB':
      'Winning a round makes you eligible. A prize also needs {threshold} order points, earned only by ordering — never by playing. Prizes are issued by our servers, not by the app.',
    'terms.oddsH': 'Prize odds',
    'terms.oddsB':
      'Prizes are drawn at random from a weighted set. Odds vary per prize and are set per campaign.',
    'terms.dataH': 'Your data',
    'terms.dataB':
      'We store your mobile number, your scores and any prizes issued. Your number is not shared for marketing by this game.',
    'terms.redeemH': 'Redeeming',
    'terms.redeemB':
      'Show your prize at the counter. Each prize is single-use and is marked redeemed by staff.',
    'terms.contactH': 'Questions',
    'terms.contactB': 'Ask a member of staff at the restaurant where you scanned the code.',

    'lb.title': 'Leaderboard',
    'lb.you': 'YOU',
    'lb.empty': 'No scores yet',
    'lb.emptyBody': 'Be the first on the board.',

    'err.title': 'Something broke',
    'err.body': 'This screen could not load. Try going back to the start.',
    'err.back': 'Back to start',
  },

  ar: {
    'lang.name': 'العربية',
    'lang.switch': 'English',

    'common.back': 'رجوع',
    'common.close': 'إغلاق',
    'common.home': 'الرئيسية',
    'common.play': 'العب',
    'common.playNow': 'العب الآن',
    'common.playAgain': 'العب مرة أخرى',
    'common.rewards': 'الجوائز',
    'common.wallet': 'جوائزي',
    'common.leaderboard': 'المتصدرون',
    'common.ranks': 'الترتيب',
    'common.terms': 'الشروط',
    'common.loading': 'جارٍ التحميل…',
    'common.retry': 'حاول مرة أخرى',
    'common.soundOn': 'الصوت مفتوح',
    'common.soundOff': 'الصوت مغلق',
    'common.toggleSound': 'تشغيل/إيقاف الصوت',
    'common.orderPoints': 'نقاط الطلبات',
    'common.offline': 'أنت غير متصل. النتائج محفوظة، لكن الجوائز تحتاج اتصالاً.',

    'welcome.title': 'اشرح القائمة<br>واكسب جوائز حقيقية',
    'welcome.sub': 'اصمد {seconds} ثانية دون تقطيع البطاطس المحروقة.',
    'welcome.greet': 'عودة موفقة، {name}؟',
    'welcome.slogan': 'أنا أحبه',
    'welcome.signIn': 'تسجيل الدخول',
    'welcome.profile': 'ملفك',
    'welcome.howTo': 'كيف تلعب',
    'welcome.prizeTeaser': 'جوائز من بطاطس مجانية إلى بيج ماك® مجاني',

    'howTo.title': 'كيف تلعب',
    'howTo.slice': 'اسحب إصبعك على الطعام لتقطيعه. تابع التقطيع لتحصل على سلاسل.',
    'howTo.avoid': 'لا تقطع البطاطس المحروقة أبداً. {lives} منها تنهي دورك.',
    'howTo.survive': 'اصمد {seconds} ثانية كاملة لتفوز بالدور.',
    'howTo.reward': 'الفوز مع نقاط طلبات كافية يمنحك جائزة حقيقية.',
    'howTo.start': 'فهمت — هيا نلعب',

    'signin.title': 'هيا نلعب!',
    'signin.sub': 'أدخل رقمك للانطلاق',
    'signin.label': 'رقم الموبايل',
    'signin.continue': 'متابعة',
    'signin.sendCode': 'أرسل الكود',
    'signin.sending': 'جارٍ الإرسال…',
    'signin.codeTitle': 'أدخل الكود',
    'signin.codeSub': 'أرسلنا كوداً من ٦ أرقام إلى {phone}',
    'signin.codeLabel': 'كود من ٦ أرقام',
    'signin.verify': 'تأكيد',
    'signin.verifying': 'جارٍ التحقق…',
    'signin.resend': 'أعد إرسال الكود',
    'signin.resendIn': 'إعادة الإرسال بعد {sec} ث',
    'signin.codeSent': 'تم إرسال الكود — راجع رسائلك',
    'signin.errCodeLen': 'أدخل الأرقام الستة من الرسالة.',
    'signin.errCodeWrong': 'الكود غير صحيح. تبقّى {left} محاولات.',
    'signin.errCodeWrongPlain': 'الكود غير صحيح.',
    'signin.errCodeExpired': 'انتهت صلاحية الكود. اطلب كوداً جديداً.',
    'signin.errCodeMany': 'محاولات كثيرة. اطلب كوداً جديداً.',
    'signin.errSendFailed': 'تعذّر إرسال الكود. حاول مرة أخرى.',
    'signin.errTooSoon': 'انتظر قليلاً قبل طلب كود آخر.',
    'signin.verified': 'تم توثيق الرقم — هيا نقطّع!',
    'signin.changeNumber': 'استخدم رقماً آخر',
    'signin.signingIn': 'جارٍ تسجيل الدخول…',
    'signin.guest': 'المتابعة كزائر',
    'signin.guestNote': 'تلعب كزائر — تدريب فقط، بدون جوائز',
    'signin.legal': 'بالمتابعة أنت توافق على شروط البرنامج. رقمك يُستخدم لهذه اللعبة فقط.',
    'signin.unverified': 'سنرسل لك كوداً من ٦ أرقام للتأكد من رقمك.',
    'signin.errEmpty': 'أدخل رقم الموبايل.',
    'signin.errDigits': 'أرقام فقط، من فضلك.',
    'signin.errShort': 'الرقم قصير جداً.',
    'signin.errLong': 'الرقم طويل جداً.',
    'signin.errCode': 'اختر مفتاح الدولة.',
    'signin.ok': 'تم تسجيل الدخول — هيا للتقطيع!',
    'signin.practice': 'تم تسجيل الدخول — وضع التدريب، بدون جوائز',
    'signin.noRewards': 'تم تسجيل الدخول — تعذّر الوصول للجوائز، تدريب فقط',

    'play.survive': 'اصمد {seconds} ث',
    'play.score': 'النقاط',
    'play.time': 'الوقت',
    'play.hint': 'اسحب على الطعام لتقطيعه — وتجنّب البطاطس المحروقة!',
    'play.pause': 'إيقاف مؤقت',
    'play.paused': 'متوقف',
    'play.pausedBody': 'خذ نفساً. دورك في انتظارك.',
    'play.resume': 'متابعة',
    'play.restart': 'إعادة',
    'play.quit': 'الخروج للرئيسية',
    'play.stakePrize': 'دور بجائزة — اصمد الدور كاملاً لتفوز.',
    'play.stakeNoIdentity': 'دور تدريبي — سجّل برقمك لتلعب على الجوائز.',
    'play.stakeLocked': 'دور تدريبي — لقد فزت مؤخراً.',
    'play.stakeOff': 'دور تدريبي — الجوائز معطّلة في هذه النسخة.',
    'play.stakeUnreachable': 'دور تدريبي — تعذّر الوصول لخدمة الجوائز.',
    'play.stakeIneligible': 'دور تدريبي — هذا الدور غير مؤهل لجائزة.',
    'play.failed': 'تعذّر بدء اللعبة',

    'result.wonTitle': 'لقد صمدت!',
    'result.lostTitle': 'احترقت!',
    'result.wonSub': 'تقطيع رائع، {name}',
    'result.lostSub': 'قطعت {lives} من البطاطس المحروقة.',
    'result.lostHint': 'اصمد {seconds} ثانية كاملة لتفوز بالدور.',
    'result.finalScore': 'النتيجة النهائية',
    'result.newBest': 'أفضل نتيجة شخصية',
    'result.slices': 'التقطيعات',
    'result.best': 'أفضل نتيجة لك',
    'result.empty': 'لا يوجد دور لعرضه',
    'result.emptyBody': 'العب دوراً أولاً — ستظهر نتيجتك هنا.',

    'reward.label': 'الجائزة',
    'reward.yours': 'جائزتك',
    'reward.savedHint': 'محفوظة في جوائزي. اعرضها عند الكاشير لاستلامها.',
    'reward.pointsLabel': 'نقاط الطلبات',
    'reward.pointsShort': 'تحتاج {short} نقطة أخرى لفتح جائزة — تُكتسب بالطلب.',
    'reward.pointsEnough': 'كافية لجائزة.',
    'reward.checkAgain': 'تحقق مرة أخرى',
    'reward.viewWallet': 'اعرض جوائزي',

    'spin.title': 'أدر واربح',
    'spin.sub': 'جائزتك اللذيذة على بُعد دورة واحدة.',
    'spin.cta': 'أدر الآن',
    'spin.spinning': 'جارٍ الإدارة…',
    'spin.minting': 'جارٍ التحقق من جائزتك…',
    'spin.copy': 'انسخ الكود',
    'spin.copied': 'تم النسخ!',
    'spin.copyManual': 'محدد — انسخه',

    'reward.awarded.title': 'لقد فزت!',
    'reward.not_eligible.title': 'صمدت في الدور!',
    'reward.not_eligible.msg': 'تحتاج نقاط طلبات أكثر لتستلم جائزة. النقاط تُكتسب بالطلب.',
    'reward.eliminated.title': 'احترقت!',
    'reward.eliminated.msg': 'قطعت الكثير من البطاطس المحروقة. اصمد الدور كاملاً لتدخل السحب.',
    'reward.pending.title': 'جائزتك في الطريق',
    'reward.pending.msg': 'تعذّر الوصول لخدمة الجوائز. دورك محفوظ — راجع جوائزي قريباً.',
    'reward.not_signed_in.title': 'دور تدريبي',
    'reward.not_signed_in.msg': 'سجّل برقمك لتلعب على جائزة حقيقية. نتيجتك محفوظة.',
    'reward.not_signed_in.cta': 'سجّل لتربح',
    'reward.unavailable.title': 'دور تدريبي',
    'reward.unavailable.msg': 'الجوائز موقوفة في هذه النسخة. نتيجتك محفوظة محلياً.',
    'reward.session_expired.title': 'انتهت صلاحية الدور',
    'reward.session_expired.msg': 'تأخر إرسال هذا الدور. العب دوراً آخر لتدخل السحب.',
    'reward.rate_limited.title': 'تمهّل قليلاً',
    'reward.rate_limited.msg': 'أدوار كثيرة بسرعة. حاول بعد قليل.',
    'reward.flagged.title': 'الدور قيد المراجعة',
    'reward.flagged.msg': 'هذا الدور يحتاج مراجعة يدوية قبل إصدار أي جائزة.',
    'reward.error.title': 'حدث خطأ ما',
    'reward.error.msg': 'تعذّر تأكيد جائزة لهذا الدور. لم تُصدر أي جائزة.',

    'wallet.title': 'جوائزي',
    'wallet.empty': 'لا جوائز بعد',
    'wallet.emptyBody': 'اصمد في دور ولديك نقاط طلبات كافية وستظهر جائزتك هنا.',
    'wallet.redeemed': 'مُستلمة',
    'wallet.active': 'جاهزة',
    'wallet.showStaff': 'اعرض هذه الشاشة للموظف للاستلام. استخدام واحد فقط.',
    'wallet.expires': 'تنتهي {date}',
    'wallet.noExpiry': 'بدون تاريخ انتهاء',
    'wallet.counterOnly': 'الاستلام عند الكاشير فقط — غير متاح داخل التطبيق بعد.',
    'wallet.serverNote': 'سجل جوائزك محفوظ على خوادمنا ويحتاج اتصالاً لتحميله.',

    'terms.title': 'الشروط والأهلية',
    'terms.intro': 'ملخّص مبسّط لكيفية عمل اللعبة وجوائزها.',
    'terms.eligibilityH': 'من يمكنه اللعب',
    'terms.eligibilityB':
      'يمكن لأي شخص لعب أدوار تدريبية. اللعب على جائزة يحتاج رقم موبايل، يُستخدم فقط لربط أدوارك وجوائزك بك.',
    'terms.rulesH': 'كيف يعمل الدور',
    'terms.rulesB':
      'الدور {seconds} ثانية. تقطيع {lives} من البطاطس المحروقة ينهيه. تفوز بالصمود الدور كاملاً.',
    'terms.prizeH': 'كيف تعمل الجوائز',
    'terms.prizeB':
      'الفوز بالدور يجعلك مؤهلاً. الجائزة تحتاج أيضاً {threshold} نقطة طلبات، تُكتسب بالطلب فقط — لا باللعب. الجوائز تُصدر من خوادمنا، لا من التطبيق.',
    'terms.oddsH': 'احتمالات الجوائز',
    'terms.oddsB': 'تُسحب الجوائز عشوائياً من مجموعة مرجّحة. الاحتمالات تختلف لكل جائزة وكل حملة.',
    'terms.dataH': 'بياناتك',
    'terms.dataB':
      'نحفظ رقم موبايلك ونتائجك وأي جوائز صادرة. رقمك لا يُشارك للتسويق من خلال هذه اللعبة.',
    'terms.redeemH': 'الاستلام',
    'terms.redeemB': 'اعرض جائزتك عند الكاشير. كل جائزة تُستخدم مرة واحدة ويؤكدها الموظف.',
    'terms.contactH': 'أسئلة',
    'terms.contactB': 'اسأل أحد الموظفين في المطعم الذي قرأت فيه رمز الاستجابة.',

    'lb.title': 'المتصدرون',
    'lb.you': 'أنت',
    'lb.empty': 'لا نتائج بعد',
    'lb.emptyBody': 'كن الأول على اللوحة.',

    'err.title': 'حدث خطأ',
    'err.body': 'تعذّر تحميل هذه الشاشة. جرّب الرجوع للبداية.',
    'err.back': 'الرجوع للبداية',
  },
};

const RTL = new Set(['ar']);

/** @type {Lang} */
let lang = 'en';
const listeners = new Set();

function detect() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    /* storage disabled */
  }
  try {
    // Match the device only on the primary subtag, so "ar-EG" counts.
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    if (nav === 'ar') return 'ar';
  } catch {
    /* no navigator */
  }
  return 'en';
}

/** Apply `lang`/`dir` to the document so CSS logical properties flip. */
function applyDocument() {
  try {
    const html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', RTL.has(lang) ? 'rtl' : 'ltr');
  } catch {
    /* no document (unit tests) */
  }
}

/**
 * Translate a key.
 *
 * Falls back through: current locale -> English -> the key itself. Rendering
 * the key is deliberate — a blank string looks like a layout bug and hides the
 * missing translation, whereas `result.title` on screen is unmissable.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function t(key, vars) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export const currentLang = () => lang;
export const isRTL = () => RTL.has(lang);

/** @param {Lang} next */
export function setLang(next) {
  if (next !== 'en' && next !== 'ar') return lang;
  lang = next;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* storage disabled */
  }
  applyDocument();
  listeners.forEach((fn) => {
    try {
      fn(lang);
    } catch {
      /* a listener must not break the switch */
    }
  });
  return lang;
}

export const toggleLang = () => setLang(lang === 'en' ? 'ar' : 'en');

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Locale-aware number formatting — Arabic uses its own digit shapes.
 *
 * Non-numeric input formats as 0 rather than "NaN". `Number(n || 0)` alone is
 * not enough: a truthy non-number like `'abc'` survives the `||` and lands on
 * screen as NaN, which is how a score readout ends up showing it.
 */
export function num(n) {
  const raw = Number(n);
  const v = Number.isFinite(raw) ? raw : 0;
  try {
    return v.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');
  } catch {
    return String(v);
  }
}

/** Every key defined for a locale — used by the completeness test. */
export const keysFor = (l) => Object.keys(STRINGS[l] || {});

export function initI18n() {
  lang = detect();
  applyDocument();
  return lang;
}
