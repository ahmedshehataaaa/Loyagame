/* ============================================================
   DESIGN STUDIO (agency-only — never shipped)
   ------------------------------------------------------------
   A freeform visual editor for every screen and popup:
   • Edit tab   — click ANY element to select it, then restyle it
                  (colors, fonts, borders, spacing, shadows) and
                  rewrite its text. Edits persist as CSS rules so
                  they survive re-renders and apply to the whole
                  matching selector.
   • Theme tab  — the global CSS variables (brand palette).
   • Screens    — jump to every screen/popup, with demo data.
   • Export     — generate js/design-overrides.js to bake the
                  design into the shipped build.

   Loads ONLY via ?design=agency (see the loader in index.html);
   the build scripts strip that loader, so shipped games cannot
   open this editor. Edits are drafted in localStorage via the
   Theme runtime, then exported.
   ============================================================ */

(() => {
  if (typeof Theme === 'undefined' || !Theme.DESIGN_MODE) return;

  // ---------- Panel styles (own stylesheet; dark, clearly "tool") ------
  const css = `
  #dz-panel{position:fixed;top:0;right:0;bottom:0;width:320px;z-index:99999;
    background:#14181f;color:#dfe6f0;font:12px/1.45 system-ui,sans-serif;
    display:flex;flex-direction:column;box-shadow:-6px 0 24px rgba(0,0,0,.5);
    direction:ltr;text-align:left}
  #dz-panel.dz-min{transform:translateX(280px)}
  #dz-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0d1015}
  #dz-head b{font-size:13px;color:#ffd84d}
  #dz-min-btn{margin-left:auto;cursor:pointer;background:#232a35;color:#dfe6f0;
    border:0;border-radius:6px;padding:4px 9px;font-weight:700}
  #dz-tabs{display:flex;background:#0d1015;padding:0 8px;gap:2px}
  .dz-tab{flex:1;padding:8px 4px;text-align:center;cursor:pointer;border:0;
    background:transparent;color:#8b93a3;font-weight:700;font-size:11px;
    border-bottom:2px solid transparent}
  .dz-tab.on{color:#ffd84d;border-bottom-color:#ffd84d}
  .dz-body{flex:1;overflow-y:auto;padding:12px}
  .dz-sec{display:none}.dz-sec.on{display:block}
  .dz-row{display:flex;align-items:center;gap:6px;margin-bottom:7px}
  .dz-row label{flex:0 0 92px;color:#8b93a3;font-size:11px}
  .dz-row input[type=text],.dz-row textarea,.dz-row select{flex:1;min-width:0;
    background:#1d232d;border:1px solid #2c3542;color:#dfe6f0;border-radius:6px;
    padding:5px 7px;font:11px/1.3 ui-monospace,monospace}
  .dz-row input[type=color]{width:26px;height:26px;border:0;padding:0;background:none;cursor:pointer}
  .dz-btn{display:inline-block;background:#232a35;color:#dfe6f0;border:0;border-radius:7px;
    padding:7px 10px;font-weight:700;font-size:11px;cursor:pointer;margin:0 6px 6px 0}
  .dz-btn:hover{background:#2e3745}
  .dz-btn.gold{background:#f2b134;color:#241a05}
  .dz-btn.red{background:#7d2019;color:#ffd9d3}
  .dz-btn.on{outline:2px solid #ffd84d}
  .dz-note{color:#8b93a3;font-size:10.5px;margin:6px 0 10px}
  .dz-selline{font:10.5px ui-monospace,monospace;color:#7fd6ff;background:#101720;
    border-radius:6px;padding:6px 8px;margin-bottom:8px;word-break:break-all}
  .dz-h{font-size:11px;font-weight:800;color:#ffd84d;margin:12px 0 6px;text-transform:uppercase;letter-spacing:.4px}
  #dz-export-ta,#dz-import-ta{width:100%;height:130px;background:#101720;color:#9fe0a8;
    border:1px solid #2c3542;border-radius:6px;font:10px/1.4 ui-monospace,monospace;padding:6px}
  .dz-hl{outline:2px dashed #7fd6ff !important;outline-offset:-1px !important;cursor:crosshair !important}
  .dz-sel{outline:3px solid #ffd84d !important;outline-offset:-2px !important}
  `;
  const styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  // ---------- Panel DOM -------------------------------------------------
  const panel = document.createElement('div');
  panel.id = 'dz-panel';
  panel.innerHTML = `
    <div id="dz-head">🎨 <b>Design Studio</b><span style="color:#8b93a3">agency</span>
      <button id="dz-min-btn">⇄</button></div>
    <div id="dz-tabs">
      <button class="dz-tab on" data-t="edit">Edit</button>
      <button class="dz-tab" data-t="theme">Theme</button>
      <button class="dz-tab" data-t="screens">Screens</button>
      <button class="dz-tab" data-t="export">Export</button>
    </div>
    <div class="dz-body">
      <div class="dz-sec on" data-s="edit">
        <button id="dz-pick" class="dz-btn gold">🎯 Select element</button>
        <button id="dz-clear-el" class="dz-btn red">Clear this element</button>
        <div class="dz-selline" id="dz-sel">— nothing selected —</div>
        <div class="dz-row"><label>Selector</label><input type="text" id="dz-sel-in"></div>
        <div class="dz-h">Text</div>
        <div class="dz-row"><textarea id="dz-text" rows="2" placeholder="(leaf elements only)"></textarea></div>
        <div class="dz-h">Style</div>
        <div id="dz-props"></div>
        <p class="dz-note">Empty a field to remove that override. Edits are saved as CSS
        rules on the selector above — widen/narrow the selector to affect more/fewer
        elements (e.g. <b>.coupon</b> = all coupon cards). Avoid text-editing live
        numbers (scores, countdowns) — the game rewrites them.</p>
      </div>
      <div class="dz-sec" data-s="theme">
        <p class="dz-note">Global brand palette — every screen updates instantly.</p>
        <div id="dz-vars"></div>
      </div>
      <div class="dz-sec" data-s="screens">
        <p class="dz-note">Jump to any screen/popup to style it.</p>
        <div id="dz-screens"></div>
        <div class="dz-h">Demo data</div>
        <button id="dz-seed" class="dz-btn">Seed demo profile</button>
        <button id="dz-unseed" class="dz-btn red">Clear demo data</button>
      </div>
      <div class="dz-sec" data-s="export">
        <p class="dz-note">Copy or download as <b>js/design-overrides.js</b>, replace that
        file, rebuild — the design ships baked-in. The restaurant cannot open this editor.</p>
        <textarea id="dz-export-ta" readonly></textarea>
        <div style="margin-top:6px">
          <button id="dz-copy" class="dz-btn gold">📋 Copy</button>
          <button id="dz-download" class="dz-btn">⬇ Download</button>
        </div>
        <div class="dz-h">Import draft (JSON)</div>
        <textarea id="dz-import-ta" placeholder='{"vars":{},"css":{},"text":{}}'></textarea>
        <div style="margin-top:6px">
          <button id="dz-import" class="dz-btn">Import</button>
          <button id="dz-reset" class="dz-btn red">Reset draft to baked design</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);
  $('#dz-min-btn').addEventListener('click', () => panel.classList.toggle('dz-min'));

  // Tabs
  panel.querySelectorAll('.dz-tab').forEach((t) => t.addEventListener('click', () => {
    panel.querySelectorAll('.dz-tab').forEach((x) => x.classList.toggle('on', x === t));
    panel.querySelectorAll('.dz-sec').forEach((s) =>
      s.classList.toggle('on', s.dataset.s === t.dataset.t));
    if (t.dataset.t === 'export') refreshExport();
    if (t.dataset.t === 'theme') buildVars();
  }));

  // ---------- Selector generation ---------------------------------------
  const OWN = ['dz-hl', 'dz-sel'];
  function selectorFor(el) {
    if (el.id) return '#' + el.id;
    const parts = [];
    while (el && el !== document.body) {
      if (el.id) { parts.unshift('#' + el.id); break; }
      let s = el.tagName.toLowerCase();
      const cls = [...el.classList].filter((c) => !OWN.includes(c) && c !== 'active').slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const p = el.parentElement;
      if (p) {
        const sibs = [...p.children].filter((c) => c.tagName === el.tagName);
        if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(el) + 1})`;
      }
      parts.unshift(s);
      el = p;
    }
    return parts.join(' > ');
  }

  // ---------- Element picking -------------------------------------------
  let picking = false, hovered = null, selected = null, curSel = '';
  const pickBtn = $('#dz-pick');
  pickBtn.addEventListener('click', () => setPicking(!picking));
  function setPicking(v) {
    picking = v;
    pickBtn.classList.toggle('on', v);
    if (!v && hovered) { hovered.classList.remove('dz-hl'); hovered = null; }
  }
  document.addEventListener('mousemove', (e) => {
    if (!picking) return;
    const el = e.target;
    if (panel.contains(el) || el === document.body || el === document.documentElement) return;
    if (hovered && hovered !== el) hovered.classList.remove('dz-hl');
    hovered = el; el.classList.add('dz-hl');
  }, true);
  document.addEventListener('click', (e) => {
    if (!picking || panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (hovered) hovered.classList.remove('dz-hl');
    select(e.target);
    setPicking(false);
  }, true);

  // ---------- Element editor --------------------------------------------
  const PROPS = [
    ['color', 'color'],
    // 'background' (shorthand) also replaces gradient backgrounds; plain
    // 'background-color' sits UNDER a background-image and won't show on
    // the gradient buttons.
    ['background', 'color'], ['background-color', 'color'], ['border-color', 'color'],
    ['font-size', 'text'], ['font-weight', 'text'], ['font-family', 'text'],
    ['border-radius', 'text'], ['border-width', 'text'], ['border-style', 'text'],
    ['padding', 'text'], ['margin', 'text'], ['box-shadow', 'text'],
    ['text-shadow', 'text'], ['letter-spacing', 'text'], ['opacity', 'text'],
    ['display', 'text'],
  ];
  const propsWrap = $('#dz-props');
  const inputs = {};
  PROPS.forEach(([prop, kind]) => {
    const row = document.createElement('div');
    row.className = 'dz-row';
    row.innerHTML = `<label>${prop}</label>` +
      (kind === 'color' ? `<input type="color" data-c="${prop}">` : '') +
      `<input type="text" data-p="${prop}">`;
    propsWrap.appendChild(row);
    const txt = row.querySelector('[data-p]');
    inputs[prop] = txt;
    txt.addEventListener('input', () => { if (curSel) Theme.setRule(curSel, prop, txt.value.trim()); });
    const swatch = row.querySelector('[data-c]');
    if (swatch) swatch.addEventListener('input', () => {
      txt.value = swatch.value;
      if (curSel) Theme.setRule(curSel, prop, swatch.value);
    });
  });

  const selLine = $('#dz-sel'), selIn = $('#dz-sel-in'), textIn = $('#dz-text');
  selIn.addEventListener('change', () => { curSel = selIn.value.trim(); fillFromSelector(); });
  textIn.addEventListener('input', () => { if (curSel) Theme.setText(curSel, textIn.value); });
  $('#dz-clear-el').addEventListener('click', () => {
    if (!curSel) return;
    Theme.clearElement(curSel);
    fillFromSelector();
  });

  function toHex(rgb) {
    const m = rgb && rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
  }
  function select(el) {
    if (selected) selected.classList.remove('dz-sel');
    selected = el; el.classList.add('dz-sel');
    curSel = selectorFor(el);
    fillFromSelector(el);
  }
  function fillFromSelector(el) {
    el = el || document.querySelector(curSel);
    selLine.textContent = curSel || '— nothing selected —';
    selIn.value = curSel;
    const rules = curSel ? Theme.rulesFor(curSel) : {};
    const comp = el ? getComputedStyle(el) : null;
    PROPS.forEach(([prop, kind]) => {
      const txt = inputs[prop];
      txt.value = rules[prop] || '';
      txt.placeholder = comp ? comp.getPropertyValue(prop) : '';
      const swatch = txt.parentElement.querySelector('[data-c]');
      if (swatch && comp) swatch.value = /^#/.test(rules[prop] || '')
        ? rules[prop] : toHex(comp.getPropertyValue(prop));
    });
    // Text editing only for leaf elements (no child elements).
    const leaf = el && el.children.length === 0;
    textIn.disabled = !leaf;
    textIn.value = curSel ? Theme.textFor(curSel) : '';
    textIn.placeholder = leaf ? (el.textContent || '') : '(leaf elements only)';
  }

  // ---------- Theme variables tab ----------------------------------------
  const VARS = ['--tomato', '--tomato2', '--gold', '--gold2', '--green', '--green2',
    '--sky1', '--sky2', '--sky3', '--ink', '--ink2', '--cream', '--line', '--night'];
  function buildVars() {
    const wrap = $('#dz-vars');
    wrap.innerHTML = '';
    const rootStyle = getComputedStyle(document.documentElement);
    const cur = Theme.get().vars;
    VARS.forEach((v) => {
      const val = (cur[v] || rootStyle.getPropertyValue(v)).trim();
      const row = document.createElement('div');
      row.className = 'dz-row';
      row.innerHTML = `<label>${v}</label><input type="color" value="${val}"><input type="text" value="${val}">`;
      wrap.appendChild(row);
      const [swatch, txt] = row.querySelectorAll('input');
      swatch.addEventListener('input', () => { txt.value = swatch.value; Theme.setVar(v, swatch.value); });
      txt.addEventListener('change', () => { Theme.setVar(v, txt.value.trim()); });
    });
  }

  // ---------- Screens tab --------------------------------------------------
  const fakeResult = () => ({
    gameScore: 2450, newHigh: true,
    coupon: { code: 'PN15-DEMO', pct: 15, label: '15% off your order',
      score: 2450, at: Date.now(), exp: Date.now() + CONFIG.DISCOUNT.expiryDays * 864e5, redeemed: false },
    nextTier: { pct: 20, label: '20% off your order', needed: 550 },
  });
  const SCREENS = [
    ['Loading', () => UI.show('loading')],
    ['Tutorial', () => UI.show('tutorial')],
    ['Verify (phone)', () => UI.showVerify()],
    ['Home', () => UI.showHome()],
    ['HUD (in-round)', () => UI.show('hud')],
    ['Pause', () => UI.show('pause')],
    ['Game Over', () => UI.showGameOver(9, fakeResult())],
    ['Locked (Saturday)', () => UI.showLocked('closed')],
    ['Locked (no plays)', () => UI.showLocked('notrials')],
    ['Privacy & Terms', () => UI.showPrivacy()],
    ['Desktop gate ⇆', () => document.getElementById('desktop-gate').classList.toggle('show')],
    ['Rotate hint ⇆', () => document.getElementById('rotate').classList.toggle('show')],
  ];
  const scWrap = $('#dz-screens');
  SCREENS.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.className = 'dz-btn'; b.textContent = label;
    b.addEventListener('click', () => { try { fn(); } catch (e) { console.warn(e); } });
    scWrap.appendChild(b);
  });
  $('#dz-seed').addEventListener('click', () => {
    LoyaltyData.setConsent(true);
    const r = LoyaltyData.requestCode('+1', '5551234567');
    LoyaltyData.verifyCode(r.demoCode);
    LoyaltyData.addOrderPoints(700);
    LoyaltyData.commitRun(2450, {});
    LoyaltyData.commitRun(800, {});
    UI.showHome();
  });
  $('#dz-unseed').addEventListener('click', () => { LoyaltyData.reset(); UI.showVerify(); });

  // ---------- Export tab ----------------------------------------------------
  const exportTa = $('#dz-export-ta');
  function refreshExport() { exportTa.value = Theme.exportFile(); }
  $('#dz-copy').addEventListener('click', async () => {
    refreshExport();
    try { await navigator.clipboard.writeText(exportTa.value); } catch {}
  });
  $('#dz-download').addEventListener('click', () => {
    refreshExport();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportTa.value], { type: 'text/javascript' }));
    a.download = 'design-overrides.js';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#dz-import').addEventListener('click', () => {
    try { Theme.set(JSON.parse($('#dz-import-ta').value)); buildVars(); fillFromSelector(); }
    catch { alert('Invalid JSON'); }
  });
  $('#dz-reset').addEventListener('click', () => {
    if (!confirm('Discard the draft and return to the baked design?')) return;
    Theme.reset(); buildVars(); fillFromSelector(); refreshExport();
  });

  // Expose for scripted testing.
  window.Designer = { select, selectorFor, setPicking };
  console.log('%c🎨 Design Studio ready — Edit tab → Select element', 'color:#ffd84d');
})();
