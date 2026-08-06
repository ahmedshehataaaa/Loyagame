/* ============================================================
   Pasta Ninja — Core Engine
   Custom HTML5 Canvas engine: scene management, pointer "blade",
   arcing food spawns, real cut-angle slicing (baked half bitmaps),
   juice particles, combos, lives, screen shake and difficulty ramp.
   ============================================================ */

const Game = (() => {
  // ---- Canvas + scaling + forced-landscape -----------------------------
  // The game is authored in a landscape box (W x H). When the device is
  // held in PORTRAIT we rotate the entire #stage 90° via CSS so the game
  // always fills the screen in landscape and is instantly playable — the
  // player doesn't have to physically turn the device.
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, offX = 0, offY = 0, dpr = 1;
  let orient = 'landscape';   // 'landscape' | 'portrait'
  let SW = CONFIG.WIDTH, SH = CONFIG.HEIGHT;  // stage logical size (landscape)
  let VW = 0;                 // frame width (for portrait pointer map)
  let VX = 0, VY = 0;         // frame origin in the window (phone frame)
  const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The game renders inside Platform.viewport(): the full window on a
    // real phone, or a centered phone-sized frame on desktop (portrait
    // for menus, landscape while playing — like rotating the phone).
    const inPlay = (scene === SCENE.PLAYING || scene === SCENE.PAUSED);
    const box = Platform.viewport(inPlay);
    VX = box.x; VY = box.y; VW = box.w;
    stage.style.left = box.x + 'px';
    stage.style.top = box.y + 'px';
    const vw = box.w, vh = box.h;
    // Force landscape ONLY during gameplay; menus follow the frame's
    // natural (portrait) orientation.
    orient = (inPlay && vh > vw) ? 'portrait' : 'landscape';

    if (orient === 'portrait') {
      // Stage logical size is landscape: long side = vh, short side = vw.
      SW = vh; SH = vw;
      stage.style.width = SW + 'px';
      stage.style.height = SH + 'px';
      stage.style.transformOrigin = '0 0';
      // Rotate 90° CW and shift back into view so it fills the viewport.
      stage.style.transform = `translate(${vw}px,0) rotate(90deg)`;
    } else {
      SW = vw; SH = vh;
      stage.style.width = SW + 'px';
      stage.style.height = SH + 'px';
      stage.style.transformOrigin = '0 0';
      stage.style.transform = 'none';
    }

    scale = Math.min(SW / W, SH / H);
    offX = (SW - W * scale) / 2;
    offY = (SH - H * scale) / 2;
    canvas.width = Math.round(SW * dpr);
    canvas.height = Math.round(SH * dpr);
    canvas.style.width = SW + 'px';
    canvas.style.height = SH + 'px';

    if (typeof Platform !== 'undefined' && Platform.updateRotateHint) Platform.updateRotateHint(orient);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  // Convert a client (window) point into virtual game coordinates:
  // shift into the phone frame, then undo the portrait stage rotation.
  function toGame(clientX, clientY) {
    const cx = clientX - VX, cy = clientY - VY;
    let lx, ly;
    if (orient === 'portrait') { lx = cy; ly = VW - cx; }
    else { lx = cx; ly = cy; }
    return { x: (lx - offX) / scale, y: (ly - offY) / scale };
  }

  // ---- State ------------------------------------------------------------
  const SCENE = { LOADING: 'loading', HOME: 'home', PLAYING: 'playing',
                  PAUSED: 'paused', GAMEOVER: 'gameover' };
  let scene = SCENE.LOADING;

  let foods = [];      // live whole items
  let halves = [];     // sliced flying halves
  let particles = [];  // juice + sparks
  let popups = [];     // floating score/combo text
  let blade = [];      // recent pointer points for the trail

  let score = 0, lives = 0;
  let combo = 0, comboTimer = 0, bestCombo = 0;
  let elapsed = 0;     // seconds into the current round
  let timeLeft = 0;    // seconds remaining in the 60s round
  let spawnTimer = 0;
  let frenzyTimer = 0; // >0 → rapid spawns
  let freezeTimer = 0; // >0 → slow-motion
  let shake = 0;
  let pointerDown = false;
  let lastSlicePos = null;

  // Short haptic buzz (mobile). Patterns: slice tick, bomb thud.
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch {} }
  let flash = 0;       // red flash on bomb hit

  // ---- Spawning ---------------------------------------------------------
  function difficulty() {
    return Math.min(elapsed / CONFIG.RAMP_TIME, 1);
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function launch(def, opts = {}) {
    const x = lerp(W * 0.12, W * 0.88, Math.random());
    const vy = -lerp(1180, 1380, Math.random());
    const vx = (W / 2 - x) * lerp(0.6, 1.1, Math.random()) + (Math.random() - 0.5) * 200;
    foods.push({
      def, x, y: H + def.radius, vx, vy,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() - 0.5) * 4,
      r: def.radius, sliced: false,
      isBomb: !!opts.isBomb, golden: !!opts.golden, special: opts.special || null,
    });
  }

  function spawnWave() {
    const d = difficulty();
    const s = CONFIG.spawn;
    // Frenzy → spawn far more frequently.
    const interval = lerp(s.easyInterval, s.hardInterval, d) * (frenzyTimer > 0 ? 0.32 : 1);
    spawnTimer = interval;

    const min = lerp(s.easyCount[0], s.hardCount[0], d);
    const max = lerp(s.easyCount[1], s.hardCount[1], d);
    let count = Math.round(lerp(min, max, Math.random()));
    if (frenzyTimer > 0) count += 2;
    const bombChance = lerp(s.bombChanceEasy, s.bombChanceHard, d);
    const pu = CONFIG.POWERUP;

    // Occasionally drop a special power-up pickup (not during frenzy).
    if (frenzyTimer <= 0 && Math.random() < pu.specialChance) {
      const kind = Math.random() < 0.5 ? 'frenzy' : 'freeze';
      launch(SPECIALS[kind], { special: kind });
    }

    for (let i = 0; i < count; i++) {
      if (frenzyTimer <= 0 && Math.random() < bombChance) { launch(BOMB, { isBomb: true }); continue; }
      const def = FOODS[(Math.random() * FOODS.length) | 0];
      launch(def, { golden: Math.random() < pu.goldenChance });
    }
  }

  // ---- Slicing ----------------------------------------------------------
  // Bake one half of an emoji into its own canvas, clipped along the
  // cut line (angle `ang`). `side` = +1 / -1 picks which half to keep.
  function bakeHalf(def, r, ang, side) {
    const size = r * 2.2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    // Draw the real per-item product sprite centered, then clip to one side.
    g.save();
    g.translate(size / 2, size / 2);
    drawItem(g, def, size);
    g.restore();
    // Mask: keep only the chosen side of the cut line.
    g.globalCompositeOperation = 'destination-in';
    g.translate(size / 2, size / 2);
    g.rotate(ang);
    g.beginPath();
    g.rect(side > 0 ? 0 : -size, -size, size, size * 2);
    g.fill();
    return c;
  }

  function sliceFood(f, dirAng) {
    f.sliced = true;
    if (!f.isBomb) totalSlices++;
    foods = foods.filter(o => o !== f);

    if (f.isBomb) {
      // BOOM — lose a life, shake, flash, scatter dark debris.
      lives--;
      shake = 26; flash = 0.6; combo = 0;
      Sound.bomb(); buzz([40, 30, 60]);
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, sp = lerp(120, 620, Math.random());
        particles.push(spark(f.x, f.y, Math.cos(a) * sp, Math.sin(a) * sp, '#2b2b2b'));
      }
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, sp = lerp(200, 700, Math.random());
        particles.push(spark(f.x, f.y, Math.cos(a) * sp, Math.sin(a) * sp, '#ff7b1a'));
      }
      if (lives <= 0) endGame();
      return;
    }

    // Special power-up pickups — activate an effect instead of scoring.
    if (f.special) {
      const pu = CONFIG.POWERUP;
      if (f.special === 'frenzy') {
        frenzyTimer = pu.frenzyDuration; spawnTimer = 0.1;
        popups.push({ x: f.x, y: f.y, text: '⚡ FRENZY!', color: '#ffe24d', life: 1.1, vy: -60, size: 36 });
      } else {
        freezeTimer = pu.freezeDuration;
        popups.push({ x: f.x, y: f.y, text: '❄️ FREEZE!', color: '#7fd6ff', life: 1.1, vy: -60, size: 36 });
      }
      Sound.reward(); buzz([20, 20, 20]);
      spawnHalves(f, dirAng); splatter(f);
      return;
    }

    // Combo chaining: slices within the window stack a multiplier.
    comboTimer = CONFIG.COMBO_WINDOW;
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    const mult = combo >= 2 ? combo : 1;
    const goldMult = f.golden ? CONFIG.POWERUP.goldenMult : 1;
    const hero = !!f.def.hero;            // Big Mac® — the iconic item
    const gained = f.def.points * mult * goldMult;
    score += gained;

    Sound.slice(combo); buzz(f.golden || hero ? 25 : 12);

    // Combos are an emotional moment, not just a stat — escalating identity.
    if (combo >= 2) {
      Sound.combo(combo);
      const name = combo >= 8 ? `HOT STREAK ×${combo}`
                 : combo >= 5 ? `GOLDEN STREAK ×${combo}`
                 : combo === 4 ? 'BIG MAC COMBO ×4'
                 : combo === 3 ? 'TRIPLE!' : 'DOUBLE!';
      const col = combo >= 8 ? '#ff2e4d' : combo >= 5 ? '#ffd23e' : combo >= 4 ? '#26d07e' : '#fff3a0';
      popups.push({ x: f.x, y: f.y - 44, text: name, color: col, life: 1.0,
        vy: -52, size: combo >= 5 ? 34 : 28 });
    }

    // Score burst — the hero Big Mac reads biggest + brightest.
    popups.push({ x: f.x, y: f.y, text: (f.golden ? '⭐ +' : '+') + gained,
      color: hero ? '#fff6d8' : f.golden ? '#ffdf3a' : '#fff', life: 0.7, vy: -90,
      size: hero ? 34 : f.golden ? 32 : 26 });

    // Real McDonald's product name floats up under the points.
    if (f.def.label) popups.push({ x: f.x, y: f.y + 22,
      text: hero ? `✨ ${f.def.label} ✨` : f.def.label,
      color: hero ? '#ffe9a8' : '#fff', life: hero ? 1.0 : 0.85, vy: -60,
      size: hero ? 18 : 15 });

    // Big Mac hero moment — a warm golden burst of sparkles.
    if (hero) for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = lerp(140, 560, Math.random());
      particles.push(spark(f.x, f.y, Math.cos(a) * sp, Math.sin(a) * sp, i % 2 ? '#fff3d0' : '#ffe08a'));
    }
    if (f.golden) for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = lerp(120, 520, Math.random());
      particles.push(spark(f.x, f.y, Math.cos(a) * sp, Math.sin(a) * sp, '#ffd84d'));
    }

    spawnHalves(f, dirAng);
    splatter(f);
  }

  // Two halves fly apart perpendicular to the cut.
  function spawnHalves(f, dirAng) {
    const nx = Math.cos(dirAng + Math.PI / 2), ny = Math.sin(dirAng + Math.PI / 2);
    [1, -1].forEach(side => {
      halves.push({
        img: bakeHalf(f.def, f.r, dirAng, side),
        x: f.x, y: f.y,
        vx: f.vx * 0.4 + nx * side * 260,
        vy: f.vy * 0.4 + ny * side * 260 - 60,
        rot: f.rot, rotVel: side * lerp(3, 6, Math.random()),
        life: 1.6, size: f.r * 2.2,
      });
    });
  }

  function splatter(f) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = lerp(80, 460, Math.random());
      particles.push(spark(f.x, f.y, Math.cos(a) * sp, Math.sin(a) * sp, f.def.juice));
    }
  }

  function spark(x, y, vx, vy, color) {
    return { x, y, vx, vy, life: lerp(0.4, 0.9, Math.random()),
             r: lerp(3, 9, Math.random()), color };
  }

  // Did the blade segment (a→b) cross food f this frame?
  function segmentHitsFood(ax, ay, bx, by, f) {
    // Distance from food centre to the segment.
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((f.x - ax) * dx + (f.y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    const dist = Math.hypot(f.x - px, f.y - py);
    return dist < f.r * 0.85;
  }

  // ---- Pointer / blade --------------------------------------------------
  function pushBlade(x, y) {
    blade.push({ x, y, t: performance.now() });
    if (blade.length > 14) blade.shift();
  }

  function handleMove(clientX, clientY) {
    const p = toGame(clientX, clientY);
    pushBlade(p.x, p.y);
    if (scene !== SCENE.PLAYING) { lastSlicePos = p; return; }
    if (!pointerDown) { lastSlicePos = p; return; }

    if (lastSlicePos) {
      const ang = Math.atan2(p.y - lastSlicePos.y, p.x - lastSlicePos.x);
      // Test every live item against this blade segment.
      for (const f of [...foods]) {
        if (segmentHitsFood(lastSlicePos.x, lastSlicePos.y, p.x, p.y, f)) {
          sliceFood(f, ang);
        }
      }
    }
    lastSlicePos = p;
  }

  function onDown(x, y) { pointerDown = true; lastSlicePos = toGame(x, y); Sound.unlock(); handleMove(x, y); }
  function onUp() { pointerDown = false; lastSlicePos = null; }

  canvas.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => handleMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0]; onDown(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) handleMove(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); onUp(); }, { passive: false });

  // ---- Update -----------------------------------------------------------
  let totalSlices = 0;

  function update(dt) {
    if (scene === SCENE.PLAYING) {
      // Round timer — when it hits zero, the round ends.
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      } else {
        elapsed += dt;
        if (frenzyTimer > 0) frenzyTimer -= dt;
        if (freezeTimer > 0) freezeTimer -= dt;
        // Freeze slows item motion (but not the round clock).
        const fdt = freezeTimer > 0 ? dt * 0.35 : dt;

        spawnTimer -= dt;
        if (spawnTimer <= 0) spawnWave();

        if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

        for (const f of foods) {
          f.vy += CONFIG.GRAVITY * fdt;
          f.x += f.vx * fdt; f.y += f.vy * fdt;
          f.rot += f.rotVel * fdt;
        }
        // Remove items that fell well below the screen.
        foods = foods.filter(f => f.y < H + 160 || f.vy < 0);
      }
    }

    // Halves, particles and popups animate in every scene (for juice
    // lingering into the game-over moment).
    for (const h of halves) {
      h.vy += CONFIG.GRAVITY * dt;
      h.x += h.vx * dt; h.y += h.vy * dt;
      h.rot += h.rotVel * dt; h.life -= dt;
    }
    halves = halves.filter(h => h.life > 0 && h.y < H + 220);

    for (const p of particles) {
      p.vy += CONFIG.GRAVITY * 0.6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    for (const u of popups) { u.y += u.vy * dt; u.life -= dt; }
    popups = popups.filter(u => u.life > 0);

    if (shake > 0) shake = Math.max(0, shake - shake * 8 * dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);

    // Fade old blade points so the trail tapers.
    const now = performance.now();
    blade = blade.filter(b => now - b.t < 120);
  }

  // ---- Render -----------------------------------------------------------
  function clearFrame() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function applyWorld() {
    let sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; }
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr,
      (offX + sx) * dpr, (offY + sy) * dpr);
  }

  // ---- Item sprites (real McDonald's product art) ----------------------
  // Every FOODS entry + the BOMB has its own transparent PNG, so each item
  // is visually distinct in flight (no shared emoji glyph). Sprites are
  // preloaded once at module load; until one is ready — or if it fails —
  // we fall back to the item's emoji so the game never renders nothing.
  const SPRITES = Object.create(null);

  (function preloadSprites() {
    const defs = (typeof FOODS !== 'undefined' ? FOODS : []).concat(
      typeof BOMB !== 'undefined' ? [BOMB] : []);
    defs.forEach((def) => {
      if (!def || !def.img || SPRITES[def.img]) return;
      const im = new Image();
      im.src = def.img;
      SPRITES[def.img] = im;
    });
  })();

  // Draw one item centered at (0,0), fitted into `size` with its real aspect
  // ratio preserved. Used by BOTH the main draw and bakeHalf, so slicing
  // splits the actual sprite along the true cut angle.
  function drawItem(g, def, size) {
    const im = def && def.img ? SPRITES[def.img] : null;
    if (im && im.complete && im.naturalWidth > 0) {
      const ar = im.naturalWidth / im.naturalHeight;
      let w = size, h = size;
      if (ar >= 1) h = size / ar; else w = size * ar;
      g.drawImage(im, -w / 2, -h / 2, w, h);
      return;
    }
    // Fallback: emoji glyph at a comparable size.
    g.font = `${size * 0.86}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((def && def.glyph) || '🍔', 0, 0);
  }


  function drawFood(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    // Golden / special items get a pulsing glow ring drawn behind them.
    if (f.golden || f.special) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
      const col = f.special === 'freeze' ? '127,214,255' : f.special === 'frenzy' ? '255,226,77' : '255,216,77';
      ctx.shadowColor = `rgba(${col},0.95)`;
      ctx.shadowBlur = 24 + pulse * 22;
      ctx.strokeStyle = `rgba(${col},${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, f.r * 1.05, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.rotate(f.rot);
    // Soft glow halo so items pop on the bright background. The hero
    // The Big Mac® gets a warm golden glow — it's the brand's identity.
    ctx.shadowColor = f.isBomb ? 'rgba(0,0,0,0.5)'
      : f.def.hero ? 'rgba(255,190,110,0.9)' : 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = f.def.hero ? 30 : 18;
    if (f.special) {
      // Power-up pickups keep their emoji (⚡ / ❄️).
      ctx.font = `${f.r * 1.9}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.def.glyph, 0, 0);
    } else {
      drawItem(ctx, f.def, f.r * 2.2);
    }
    if (f.isBomb) {
      // pulsing danger ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,60,60,' + (0.5 + 0.5 * Math.sin(performance.now() / 120)) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, f.r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHalf(h) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, h.life);
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.drawImage(h.img, -h.size / 2, -h.size / 2, h.size, h.size);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    for (const u of popups) {
      ctx.globalAlpha = Math.max(0, u.life / 0.9);
      ctx.font = `900 ${u.size}px system-ui, sans-serif`;
      ctx.fillStyle = u.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 5;
      ctx.strokeText(u.text, u.x, u.y);
      ctx.fillText(u.text, u.x, u.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawBlade() {
    if (blade.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < blade.length; i++) {
      const a = blade[i - 1], b = blade[i];
      const t = i / blade.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + t * 0.55})`;
      ctx.lineWidth = 2 + t * 16;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // bright core
    for (let i = 1; i < blade.length; i++) {
      const a = blade[i - 1], b = blade[i];
      const t = i / blade.length;
      ctx.strokeStyle = `rgba(120,230,255,${t * 0.8})`;
      ctx.lineWidth = 1 + t * 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Rounded-rect helper for high-contrast HUD chips.
  function chip(x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawHUD() {
    ctx.textBaseline = 'alphabetic';

    // Publish live values onto the canvas dataset so a DOM HUD can
    // mirror them without the engine importing any UI module.
    const ds = canvas.dataset;
    ds.score  = String(score);
    ds.time   = String(Math.max(0, Math.ceil(timeLeft)));
    ds.lives  = String(Math.max(0, lives));
    ds.combo  = String(combo);
    ds.slices = String(totalSlices);


    // SCORE sticker (cream, top-left, ink border) — board style.
    chip(24, 18, 206, 70, 16, '#f5e9d0');
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7d0c12';
    ctx.font = '15px "Anton", "Baloo 2", sans-serif';
    ctx.fillText('SCORE', 127, 40);
    ctx.font = '38px "Anton", "Baloo 2", sans-serif';
    ctx.fillText(score.toLocaleString(), 127, 78);

    // Combo stamp — red sticker circle under the score.
    if (combo >= 2) {
      ctx.globalAlpha = Math.min(1, comboTimer / CONFIG.COMBO_WINDOW + 0.3);
      ctx.beginPath(); ctx.arc(70, 150, 42, 0, Math.PI * 2);
      ctx.fillStyle = '#a8121a'; ctx.fill();
      ctx.strokeStyle = '#f5e9d0'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#f5e9d0';
      ctx.font = '22px "Anton", sans-serif';
      ctx.fillText(`x${combo}`, 70, 147);
      ctx.font = '12px "Anton", sans-serif';
      ctx.fillText('COMBO', 70, 166);
      ctx.globalAlpha = 1;
    }

    // TIMER chip (top-right, clear of the round buttons). Red in final 10s.
    const tSec = Math.ceil(timeLeft);
    const low = timeLeft <= 10;
    chip(W - 330, 20, 140, 52, 26, low ? '#ff4b2b' : '#f5e9d0');
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = low ? '#fff' : '#141414';
    ctx.font = '30px "Anton", "Baloo 2", sans-serif';
    const mm = Math.floor(tSec / 60), ss = tSec % 60;
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, W - 260, 57);

    // Lives as chilis, bottom-left (board style).
    ctx.textAlign = 'left';
    ctx.font = '30px serif';
    let chilis = '';
    for (let i = 0; i < lives; i++) chilis += '🌶️';
    ctx.fillText(chilis || '💀', 24, H - 22);

    // Active power-up banner.
    if (frenzyTimer > 0 || freezeTimer > 0) {
      const fz = freezeTimer > 0;
      ctx.textAlign = 'center';
      ctx.font = '26px "Anton", "Baloo 2", sans-serif';
      ctx.fillStyle = fz ? '#7fd6ff' : '#ffe24d';
      ctx.strokeStyle = 'rgba(20,20,20,0.55)';
      ctx.lineWidth = 5;
      const txt = fz ? `❄️ FREEZE ${Math.ceil(freezeTimer)}` : `⚡ FRENZY ${Math.ceil(frenzyTimer)}`;
      ctx.strokeText(txt, W / 2, H - 28);
      ctx.fillText(txt, W / 2, H - 28);
    }
  }

  function render() {
    clearFrame();
    applyWorld();

    if (scene === SCENE.PLAYING || scene === SCENE.PAUSED || scene === SCENE.GAMEOVER) {
      foods.forEach(drawFood);
      halves.forEach(drawHalf);
      drawParticles();
      drawPopups();
      if (scene === SCENE.PLAYING) drawHUD();
    }

    // Freeze tint over the playfield.
    if (freezeTimer > 0 && scene === SCENE.PLAYING) {
      ctx.fillStyle = `rgba(120,200,255,${Math.min(0.22, freezeTimer * 0.06)})`;
      ctx.fillRect(-200, -200, W + 400, H + 400);
    }

    // Blade always renders so the cursor feels alive in menus too.
    drawBlade();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${flash * 0.5})`;
      ctx.fillRect(-200, -200, W + 400, H + 400);
    }
  }

  // ---- Loop -------------------------------------------------------------
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- Scene control ----------------------------------------------------
  function startGame(opts = {}) {
    foods = []; halves = []; particles = []; popups = [];
    score = 0; lives = CONFIG.START_LIVES; totalSlices = 0;
    combo = 0; comboTimer = 0; bestCombo = 0;
    elapsed = 0; spawnTimer = 0.6; shake = 0; flash = 0;
    frenzyTimer = 0; freezeTimer = 0;
    timeLeft = CONFIG.ROUND_TIME;
    scene = SCENE.PLAYING;
    resize();            // force landscape for the round
    UI.show('hud');
  }

  // Idle (menu) state — canvas keeps rendering the blade/background while
  // a DOM overlay (verify, home, locked, wallet) is shown by main.js.
  function idle() {
    scene = SCENE.HOME;
    foods = []; halves = []; particles = []; popups = [];
    resize();            // menus follow natural (portrait) orientation
  }

  function pauseGame() {
    if (scene !== SCENE.PLAYING) return;
    scene = SCENE.PAUSED;
    UI.show('pause');
  }
  function resumeGame() {
    if (scene !== SCENE.PAUSED) return;
    scene = SCENE.PLAYING;
    resize();
    UI.show('hud');
  }

  async function endGame() {
    scene = SCENE.GAMEOVER;
    resize();
    Sound.gameover();
    // Submit the round (with real duration so the server can spot impossible
    // runs). Score >= threshold → prize wheel; otherwise → try-again nudge.
    const result = await LoyaltyData.submitRun(score, Math.round(elapsed * 1000));
    if (result.won) {
      setTimeout(() => Sound.reward(), 300);
      UI.showChooser(score, result);      // HOT NOW unlocked → choose a reward
    } else {
      UI.showHome();                        // backdrop for the popup
      UI.showTryAgain(score, result.gap, LoyaltyData.getPlaysLeft(), result.newHigh);
    }
  }

  function goHome() {
    scene = SCENE.HOME;
    foods = []; halves = []; particles = []; popups = [];
    UI.show('home');
    UI.refreshHome();
  }

  function finishLoading() {
    scene = SCENE.HOME;
    UI.show('home');
    UI.refreshHome();
  }

  // ---- Boot -------------------------------------------------------------
  function init() {
    resize();
    requestAnimationFrame(loop);
  }

  return { init, SCENE, startGame, idle, pauseGame, resumeGame, endGame, goHome,
           finishLoading, getScene: () => scene };
})();

// Expose for ES module consumers (top-level const does not attach to window).
window.Game = Game;
