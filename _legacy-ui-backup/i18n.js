/* ============================================================
   i18n — English + Arabic (RTL) strings. Toggle from the home
   screen. Any element with data-i18n="key" gets translated;
   dir=rtl is applied to <html> for Arabic.
   ============================================================ */

const I18N = (() => {
  const STRINGS = {
    en: {
      tagline: 'Slice the menu, climb the ranks, win real rewards!',
      play: '▶ PLAY',
      myRewards: '🎁 My Rewards',
      howto: 'Swipe to slice · avoid the BURNT 💣 · 60s rounds',
      trainingBadge: '🎮 Free training — play anytime',
      changeNumber: 'Change number',
      reset: 'Reset',
      loyaltyPts: 'LOYALTY PTS',
      highScore: 'YOUR BEST',
      verifyTitle: 'Enter your number to play',
      verifySub: 'Order to earn points, then spin the Prize Wheel!',
      phonePlaceholder: 'Phone number',
      consent: 'I accept the program terms.',
      sendCode: 'Continue',
      privacyLine: '🔒 Your number is used only for this loyalty program. We never share it.',
      privacy: 'Privacy & Terms',
      timesUp: 'Hidden Gem Alert!!!',
      playAgain: 'Try Again',
      home: 'Home',
      rewardsBtn: '🎁 Rewards',
      gameScore: 'GAME SCORE',
      bestCombo: 'BEST COMBO',
      loyaltyEarned: 'LOYALTY EARNED',
      totalPoints: 'TOTAL POINTS',
      comeBackSat: 'Next Heat Wave!',
      back: '← Back',
      skip: 'Skip',
      gotIt: "Got it! Let's slice 🔪",
      howtoTitle: 'How to play',
      lang: 'العربية',
      proTip: "Pro Tip: I'm Lovin' The Combos.",
      tutTitle: 'Swipe to Slice!',
      tut1t: 'Swipe', tut1s: 'Slice Big Macs, fries, nuggets & more',
      tut2t: 'Avoid the Burnt', tut2s: 'Slicing the burnt fries costs a life!',
      tut3t: 'Spin & win', tut3s: 'Earn 4,000 points to spin the Prize Wheel',
      next: 'Next ▸',
      rotateHint: 'Rotate your phone to slice!',
      gateTitle: 'Too hot for desktop!',
      gateSub: 'Scan to play on your phone.',
      close: '✕ Close',
      prizesBtn: '🏆 Prizes & Leaderboard',
      best: 'BEST',
      glazeMeter: 'REWARD METER',
      wbSub: 'Order to earn points, then claim a reward',
      wbTop: 'TOP REWARD',
      wbStandings: 'Live standings',
      rankTitle: 'Live Standings',
      rankSub: 'How you stack up this month',
      rankYou: 'YOUR POSITION',
      rankBest: 'BEST SCORE',
      rankPlay: '▶ Play a round',
      wbSoon: 'Standings coming soon',
      wbSoonSub: 'Rankings go live once enough players are in this month.',
      wbMore: '🔥 Bake more points',
      hotNow: 'HOT NOW',
      viewAll: 'View all',
      newBest: 'NEW BEST!',
      winBig: 'Win Big',
      spinHead: 'Rewards you can win',
      chooseReward: 'Choose your reward',
    },
    ar: {
      tagline: 'قطّع الدوناتس، أدر العجلة، واكسب جوائز حلوة!',
      play: '▶ ابدأ',
      myRewards: '🎁 جوائزي',
      howto: 'مرّر لتقطيع · تجنّب الدوناتس المحروق 💣 · جولات ٦٠ ثانية',
      trainingBadge: '🎮 تدريب مجاني — العب في أي وقت',
      changeNumber: 'تغيير الرقم',
      reset: 'إعادة ضبط',
      loyaltyPts: 'نقاط الولاء',
      highScore: 'أفضل نتيجة',
      verifyTitle: 'أدخل رقمك للعب',
      verifySub: 'اطلب لتجمع النقاط، ثم أدر عجلة الجوائز!',
      phonePlaceholder: 'رقم الهاتف',
      consent: 'أوافق على شروط البرنامج.',
      sendCode: 'متابعة',
      privacyLine: '🔒 يُستخدم رقمك فقط لبرنامج الولاء هذا. لن نشاركه أبدًا.',
      privacy: 'الخصوصية والشروط',
      timesUp: 'أنت نار!!!',
      playAgain: 'حاول مجددًا',
      home: 'الرئيسية',
      rewardsBtn: '🎁 الجوائز',
      gameScore: 'نتيجة اللعبة',
      bestCombo: 'أفضل كومبو',
      loyaltyEarned: 'نقاط مكتسبة',
      totalPoints: 'إجمالي النقاط',
      comeBackSat: 'عُد يوم السبت!',
      back: '← رجوع',
      skip: 'تخطّي',
      gotIt: 'تمام! هيا نقطّع 🔪',
      howtoTitle: 'طريقة اللعب',
      lang: 'English',
      proTip: 'نصيحة: مُحلّى. حلو. لا يُقاوَم.',
      tutTitle: 'مرّر لتقطّع!',
      tut1t: 'مرّر', tut1s: 'قطّع الدوناتس المحلّى والمحشو والمزيّن',
      tut2t: 'تجنّب المحروق', tut2s: 'تقطيع الدوناتس المحروق يكلّفك حياة!',
      tut3t: 'أدر واربح', tut3s: 'اجمع ٤٠٠٠ نقطة لتدير عجلة الجوائز',
      next: '◂ التالي',
      rotateHint: 'أدر هاتفك لتبدأ التقطيع!',
      gateTitle: 'العب على هاتفك!',
      gateSub: 'امسح الرمز للعب على هاتفك.',
      close: '✕ إغلاق',
      prizesBtn: '🏆 الجوائز والمتصدرون',
      best: 'الأفضل',
      glazeMeter: 'مقياس التزجيج',
      wbSub: 'اطلب واجمع نقاط، ثم احصل على جائزتك',
      wbTop: 'أفضل جائزة',
      wbStandings: 'الترتيب المباشر',
      rankTitle: 'الترتيب المباشر',
      rankSub: 'ترتيبك هذا الشهر',
      rankYou: 'مركزك',
      rankBest: 'أفضل نتيجة',
      rankPlay: '▶ العب جولة',
      wbSoon: 'الترتيب قريباً',
      wbSoonSub: 'يظهر الترتيب عند انضمام لاعبين كافين هذا الشهر.',
      wbMore: '🔥 اجمع نقاط أكثر',
      hotNow: 'ساخن الآن',
      viewAll: 'عرض الكل',
      newBest: 'رقم قياسي جديد!',
      winBig: 'اربح الكبرى',
      spinHead: 'الجوائز اللي ممكن تربحها',
      chooseReward: 'اختر جائزتك',
    },
  };

  let lang = 'en';
  try { lang = localStorage.getItem('ffn_lang') || 'en'; } catch {}

  function t(key) { return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key; }

  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
  }

  function set(l) {
    lang = STRINGS[l] ? l : 'en';
    try { localStorage.setItem('ffn_lang', lang); } catch {}
    apply();
  }
  function toggle() { set(lang === 'en' ? 'ar' : 'en'); }

  return { t, apply, set, toggle, get: () => lang };
})();
