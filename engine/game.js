/* ============================================================
   Pasta Ninja — Core Engine
   Custom HTML5 Canvas engine: scene management, pointer "blade",
   arcing food spawns, real cut-angle slicing (baked half bitmaps),
   juice particles, combos, lives, screen shake and difficulty ramp.
   ============================================================ */

const Game = (() => {
  // ---- Canvas + scaling (portrait) --------------------------------------
  // The game is authored PORTRAIT (W x H from CONFIG) and drawn upright.
  //
  // This used to author landscape and rotate the whole #stage 90° in CSS to
  // "fill" a portrait phone. That left the canvas — including its HUD — lying
  // on its side beneath the un-rotated DOM HUD, and forced a coordinate
  // transform on every pointer event. Portrait-native removes the rotation,
  // the transform, and the orientation gate in one go (ADR 0006).
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1,
    offX = 0,
    offY = 0,
    dpr = 1;
  let SW = CONFIG.WIDTH,
    SH = CONFIG.HEIGHT; // stage size in CSS px
  const W = CONFIG.WIDTH,
    H = CONFIG.HEIGHT;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const inPlay = scene === SCENE.PLAYING || scene === SCENE.PAUSED;
    const box = Platform.viewport(inPlay);
    stage.style.left = box.x + 'px';
    stage.style.top = box.y + 'px';
    stage.style.transform = 'none';
    SW = box.w;
    SH = box.h;
    stage.style.width = SW + 'px';
    stage.style.height = SH + 'px';

    // COVER, not contain: the play field fills the stage and the overflow is
    // clipped. `contain` would letterbox the field on tall/narrow phones,
    // which is what left the dead bands visible around the old play area.
    scale = Math.max(SW / W, SH / H);
    offX = (SW - W * scale) / 2;
    offY = (SH - H * scale) / 2;
    canvas.width = Math.round(SW * dpr);
    canvas.height = Math.round(SH * dpr);
    canvas.style.width = SW + 'px';
    canvas.style.height = SH + 'px';
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  // Client (window) point -> virtual game coordinates. No rotation term now
  // that the stage is upright; the canvas rect is read directly so the mapping
  // stays correct regardless of where the stage sits in the page.
  function toGame(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - offX) / scale,
      y: (clientY - rect.top - offY) / scale,
    };
  }

  // ---- State ------------------------------------------------------------
  const SCENE = {
    LOADING: 'loading',
    HOME: 'home',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAMEOVER: 'gameover',
  };
  let scene = SCENE.LOADING;

  let foods = []; // live whole items
  let halves = []; // sliced flying halves
  let particles = []; // juice + sparks
  let popups = []; // floating score/combo text
  let blade = []; // recent pointer points for the trail

  let score = 0,
    lives = 0;
  let combo = 0,
    comboTimer = 0,
    bestCombo = 0;
  let elapsed = 0; // seconds into the current round
  let timeLeft = 0; // seconds remaining in the round (CONFIG.ROUND_TIME)
  let spawnTimer = 0;
  let frenzyTimer = 0; // >0 → rapid spawns
  let freezeTimer = 0; // >0 → slow-motion
  let shake = 0;
  let pointerDown = false;
  let lastSlicePos = null;

  // Short haptic buzz (mobile). Patterns: slice tick, bomb thud.
  function buzz(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {}
  }
  let flash = 0; // red flash on bomb hit

  // ---- Spawning ---------------------------------------------------------
  // Wave composition, ballistics and the hazard-fairness guarantee all live in
  // tested pure modules (src/game/) reached through window.Mechanics. Keeping
  // them out of here is what makes them unit-testable without a canvas.
  const lerp = (a, b, t) => a + (b - a) * t;

  function difficulty() {
    return Mechanics.difficultyAt(elapsed, CONFIG.ROUND_TIME, CONFIG.RAMP_FRACTION);
  }

  /** Turn one planned spawn into a live item. */
  function launchPlanned(def, spawn, opts = {}) {
    const startX = spawn.startXFrac * W;
    const { vx, vy } = Mechanics.solveLaunch({
      gravity: CONFIG.GRAVITY,
      fieldHeight: H,
      startX,
      targetX: spawn.targetXFrac * W,
      apexFrac: spawn.apexFrac,
    });
    foods.push({
      def,
      x: startX,
      y: H + def.radius,
      vx,
      vy,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() - 0.5) * 4,
      r: def.radius,
      sliced: false,
      isBomb: !!opts.isBomb,
      golden: !!opts.golden,
      special: opts.special || null,
    });
  }

  function spawnWave() {
    const wave = Mechanics.planWave({
      difficulty: difficulty(),
      rng: Math.random,
      frenzy: frenzyTimer > 0,
      tuning: {
        ...CONFIG.spawn,
        goldenChance: CONFIG.POWERUP.goldenChance,
        specialChance: CONFIG.POWERUP.specialChance,
        apexMin: CONFIG.LAUNCH.apexMin,
        apexMax: CONFIG.LAUNCH.apexMax,
        maxLateralFrac: CONFIG.LAUNCH.maxLateralFrac,
        marginFrac: CONFIG.LAUNCH.marginFrac,
      },
    });
    spawnTimer = wave.intervalSec;

    for (const spawn of wave.spawns) {
      if (spawn.kind === 'bomb') {
        launchPlanned(BOMB, spawn, { isBomb: true });
      } else if (spawn.kind === 'special') {
        launchPlanned(SPECIALS[spawn.special], spawn, { special: spawn.special });
      } else {
        const def = FOODS[(Math.random() * FOODS.length) | 0];
        launchPlanned(def, spawn, { golden: spawn.golden });
      }
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
    foods = foods.filter((o) => o !== f);

    if (f.isBomb) {
      // BOOM — lose a life, shake, flash, scatter dark debris.
      lives--;
      addShake(CONFIG.FX.maxShake);
      flash = fxReduced() ? 0.25 : 0.6;
      combo = 0;
      Sound.bomb();
      buzz([40, 30, 60]);
      // Char first, then embers: two passes read as one impact, not two.
      emitBurst(f.x, f.y, 26, () => '#2b2b2b', 120, 620);
      emitBurst(f.x, f.y, 14, () => '#ff7b1a', 200, 700);
      // Name the mistake. A bomb hit is the only moment the player MUST
      // understand, and a life vanishing from the HUD is easy to miss.
      emitPopup({
        x: f.x,
        y: f.y - 30,
        text: lives > 0 ? 'BURNT! -1' : 'BURNT OUT!',
        color: '#ff7b1a',
        life: 1.0,
        vy: -70,
        size: 32,
      });
      if (lives <= 0) endGame();
      return;
    }

    // Special power-up pickups — activate an effect instead of scoring.
    if (f.special) {
      const pu = CONFIG.POWERUP;
      if (f.special === 'frenzy') {
        frenzyTimer = pu.frenzyDuration;
        spawnTimer = 0.1;
        emitPopup({
          x: f.x,
          y: f.y,
          text: '⚡ FRENZY!',
          color: '#ffe24d',
          life: 1.1,
          vy: -60,
          size: 36,
        });
      } else {
        freezeTimer = pu.freezeDuration;
        emitPopup({
          x: f.x,
          y: f.y,
          text: '❄️ FREEZE!',
          color: '#7fd6ff',
          life: 1.1,
          vy: -60,
          size: 36,
        });
      }
      Sound.reward();
      buzz([20, 20, 20]);
      spawnHalves(f, dirAng);
      splatter(f);
      return;
    }

    // Combo chaining: slices within the window stack a multiplier.
    comboTimer = CONFIG.COMBO_WINDOW;
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    const mult = combo >= 2 ? combo : 1;
    const goldMult = f.golden ? CONFIG.POWERUP.goldenMult : 1;
    const hero = !!f.def.hero; // Big Mac® — the iconic item
    const gained = f.def.points * mult * goldMult;
    score += gained;

    Sound.slice(combo);
    buzz(f.golden || hero ? 25 : 12);

    // Combos are an emotional moment, not just a stat — escalating identity.
    if (combo >= 2) {
      Sound.combo(combo);
      const name =
        combo >= 8
          ? `HOT STREAK ×${combo}`
          : combo >= 5
            ? `GOLDEN STREAK ×${combo}`
            : combo === 4
              ? 'BIG MAC COMBO ×4'
              : combo === 3
                ? 'TRIPLE!'
                : 'DOUBLE!';
      const col =
        combo >= 8 ? '#ff2e4d' : combo >= 5 ? '#ffd23e' : combo >= 4 ? '#26d07e' : '#fff3a0';
      emitPopup({
        x: f.x,
        y: f.y - 44,
        text: name,
        color: col,
        life: 1.0,
        vy: -52,
        size: combo >= 5 ? 34 : 28,
      });
    }

    // Score burst — the hero Big Mac reads biggest + brightest.
    emitPopup({
      x: f.x,
      y: f.y,
      text: (f.golden ? '⭐ +' : '+') + gained,
      color: hero ? '#fff6d8' : f.golden ? '#ffdf3a' : '#fff',
      life: 0.7,
      vy: -90,
      size: hero ? 34 : f.golden ? 32 : 26,
    });

    // Real McDonald's product name floats up under the points.
    if (f.def.label)
      emitPopup({
        optional: true,
        x: f.x,
        y: f.y + 22,
        text: hero ? `✨ ${f.def.label} ✨` : f.def.label,
        color: hero ? '#ffe9a8' : '#fff',
        life: hero ? 1.0 : 0.85,
        vy: -60,
        size: hero ? 18 : 15,
      });

    // Big Mac hero moment — a warm golden burst of sparkles.
    // The hero item gets a warm burst and a whisper of shake — the one place
    // shake is used for celebration rather than damage.
    if (hero) {
      emitBurst(f.x, f.y, 18, (i) => (i % 2 ? '#fff3d0' : '#ffe08a'), 140, 560);
      addShake(CONFIG.FX.heroShake);
    }
    if (f.golden) emitBurst(f.x, f.y, 14, () => '#ffd84d', 120, 520);

    spawnHalves(f, dirAng);
    splatter(f);
  }

  // Two halves fly apart perpendicular to the cut.
  function spawnHalves(f, dirAng) {
    const nx = Math.cos(dirAng + Math.PI / 2),
      ny = Math.sin(dirAng + Math.PI / 2);
    [1, -1].forEach((side) => {
      Mechanics.capPush(
        halves,
        {
          img: bakeHalf(f.def, f.r, dirAng, side),
          x: f.x,
          y: f.y,
          vx: f.vx * 0.4 + nx * side * 260,
          vy: f.vy * 0.4 + ny * side * 260 - 60,
          rot: f.rot,
          rotVel: side * lerp(3, 6, Math.random()),
          life: 1.6,
          size: f.r * 2.2,
        },
        CONFIG.FX.maxHalves,
      );
    });
  }

  function splatter(f) {
    emitBurst(f.x, f.y, 16, () => f.def.juice, 80, 460);
  }

  /* ---- Effect emission, budgeted ---------------------------------------
     Every effect now goes through these. The lists used to be pushed to
     directly and grew unbounded for the whole round (audit finding P7); these
     enforce CONFIG.FX ceilings and honour reduced motion in one place, so a
     new effect cannot accidentally opt out of either. */
  const fxReduced = () => Platform.reducedMotion();

  function emitParticle(pt) {
    Mechanics.capPush(particles, pt, CONFIG.FX.maxParticles);
  }

  /** Emit a radial burst, scaled to the remaining budget. */
  function emitBurst(x, y, count, colorFor, speedMin, speedMax) {
    const n = Mechanics.burstSize(count, {
      inUse: particles.length,
      max: CONFIG.FX.maxParticles,
      reduced: fxReduced(),
      reducedScale: CONFIG.FX.reducedParticleScale,
    });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = lerp(speedMin, speedMax, Math.random());
      emitParticle(spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, colorFor(i)));
    }
  }

  function emitPopup(u) {
    // Popups are text over the play field, so they are the effect most able to
    // hide an item. Kept on a tighter leash than particles.
    if (fxReduced() && u.optional) return;
    Mechanics.capPush(popups, u, CONFIG.FX.maxPopups);
  }

  function addShake(amount) {
    shake = Math.max(
      shake,
      Mechanics.shakeAmount(amount, {
        max: CONFIG.FX.maxShake,
        reduced: fxReduced(),
        reducedScale: CONFIG.FX.reducedShakeScale,
      }),
    );
  }

  function spark(x, y, vx, vy, color) {
    return {
      x,
      y,
      vx,
      vy,
      life: lerp(0.4, 0.9, Math.random()),
      r: lerp(3, 9, Math.random()),
      color,
    };
  }

  // Did the blade segment (a→b) cross food f this frame? Tolerance comes from
  // CONFIG (>1 = slightly forgiving); the old inline 0.85 made every hitbox
  // 15% SMALLER than the sprite the player was aiming at.
  function segmentHitsFood(ax, ay, bx, by, f) {
    return Mechanics.segmentHitsCircle(ax, ay, bx, by, f.x, f.y, f.r, CONFIG.HIT_TOLERANCE);
  }

  // ---- Pointer / blade --------------------------------------------------
  function pushBlade(x, y) {
    Mechanics.capPush(blade, { x, y, t: performance.now() }, CONFIG.FX.bladePoints);
  }

  function handleMove(clientX, clientY) {
    const p = toGame(clientX, clientY);
    pushBlade(p.x, p.y);
    if (scene !== SCENE.PLAYING) {
      lastSlicePos = p;
      return;
    }
    if (!pointerDown) {
      lastSlicePos = p;
      return;
    }

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

  function onDown(x, y) {
    pointerDown = true;
    lastSlicePos = toGame(x, y);
    Sound.unlock();
    handleMove(x, y);
  }
  function onUp() {
    pointerDown = false;
    lastSlicePos = null;
  }

  canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      onDown(t.clientX, t.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) handleMove(t.clientX, t.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener(
    'touchend',
    (e) => {
      e.preventDefault();
      onUp();
    },
    { passive: false },
  );

  // ---- Update -----------------------------------------------------------
  let totalSlices = 0;

  function update(dt) {
    if (scene === SCENE.PLAYING) {
      // Round timer — when it hits zero, the round ends.
      const prevTimeLeft = timeLeft;
      timeLeft -= dt;

      /* Countdown urgency. Fires exactly once per whole second in the closing
         stretch, derived from the second boundary being crossed rather than
         from a per-frame check — the latter would tick 60 times a second at
         60fps and once a second at 1fps. */
      if (Mechanics.shouldTick(prevTimeLeft, timeLeft, CONFIG.FX.tickFromSec)) {
        Sound.tick(Math.ceil(timeLeft));
      }
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

        if (comboTimer > 0) {
          comboTimer -= dt;
          if (comboTimer <= 0) combo = 0;
        }

        for (const f of foods) {
          f.vy += CONFIG.GRAVITY * fdt;
          f.x += f.vx * fdt;
          f.y += f.vy * fdt;
          f.rot += f.rotVel * fdt;
        }
        // Remove items that fell well below the screen.
        foods = foods.filter((f) => f.y < H + 160 || f.vy < 0);
      }
    }

    // Halves, particles and popups animate in every scene (for juice
    // lingering into the game-over moment).
    for (const h of halves) {
      h.vy += CONFIG.GRAVITY * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.rotVel * dt;
      h.life -= dt;
    }
    halves = halves.filter((h) => h.life > 0 && h.y < H + 220);

    for (const p of particles) {
      p.vy += CONFIG.GRAVITY * 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const u of popups) {
      u.y += u.vy * dt;
      u.life -= dt;
    }
    popups = popups.filter((u) => u.life > 0);

    if (shake > 0) shake = Math.max(0, shake - shake * 8 * dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);

    // Fade old blade points so the trail tapers.
    const now = performance.now();
    blade = blade.filter((b) => now - b.t < 120);
  }

  // ---- Render -----------------------------------------------------------
  function clearFrame() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function applyWorld() {
    let sx = 0,
      sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake;
      sy = (Math.random() - 0.5) * shake;
    }
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * dpr, (offY + sy) * dpr);
  }

  // ---- Item sprites (real McDonald's product art) ----------------------
  // Every FOODS entry + the BOMB has its own transparent PNG, so each item
  // is visually distinct in flight (no shared emoji glyph). Sprites are
  // preloaded once at module load; until one is ready — or if it fails —
  // we fall back to the item's emoji so the game never renders nothing.
  const SPRITES = Object.create(null);

  (function preloadSprites() {
    const defs = (typeof FOODS !== 'undefined' ? FOODS : []).concat(
      typeof BOMB !== 'undefined' ? [BOMB] : [],
    );
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
      let w = size,
        h = size;
      if (ar >= 1) h = size / ar;
      else w = size * ar;
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
      const col =
        f.special === 'freeze'
          ? '127,214,255'
          : f.special === 'frenzy'
            ? '255,226,77'
            : '255,216,77';
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
    ctx.shadowColor = f.isBomb
      ? 'rgba(0,0,0,0.5)'
      : f.def.hero
        ? 'rgba(255,190,110,0.9)'
        : 'rgba(0,0,0,0.25)';
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
      const a = blade[i - 1],
        b = blade[i];
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
      const a = blade[i - 1],
        b = blade[i];
      const t = i / blade.length;
      // Golden core, not cyan: the trail is the most-seen element in the game
      // and was the one piece of UI still wearing the old build's palette.
      ctx.strokeStyle = `rgba(255,199,44,${t * 0.9})`;
      ctx.lineWidth = 1 + t * 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /* The canvas no longer draws a HUD.

     It used to draw score/timer/lives itself AND publish the same values for
     the DOM overlay in src/pages/play.js to draw — so both rendered at once,
     overlapping, and disagreed: the canvas showed lives as 🌶️ chillies left
     over from the Pasta & Heat build while the DOM showed ❤. Deleting the
     canvas side removes the duplication and the stale branding together, and
     leaves one owner for in-round UI (the DOM, which gets real fonts,
     accessibility and safe-area insets for free).

     This function now only publishes state. Values land on the canvas dataset
     so the engine still imports no UI module. */
  function publishState() {
    const ds = canvas.dataset;
    ds.score = String(score);
    ds.time = String(Math.max(0, Math.ceil(timeLeft)));
    ds.lives = String(Math.max(0, lives));
    ds.combo = String(combo);
    ds.slices = String(totalSlices);
    ds.frenzy = String(Math.max(0, Math.ceil(frenzyTimer)));
    ds.freeze = String(Math.max(0, Math.ceil(freezeTimer)));
  }

  function render() {
    clearFrame();
    applyWorld();

    if (scene === SCENE.PLAYING || scene === SCENE.PAUSED || scene === SCENE.GAMEOVER) {
      foods.forEach(drawFood);
      halves.forEach(drawHalf);
      drawParticles();
      drawPopups();
      if (scene === SCENE.PLAYING) publishState();
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
  function startGame() {
    foods = [];
    halves = [];
    particles = [];
    popups = [];
    score = 0;
    lives = CONFIG.START_LIVES;
    totalSlices = 0;
    combo = 0;
    comboTimer = 0;
    bestCombo = 0;
    elapsed = 0;
    spawnTimer = 0.6;
    shake = 0;
    flash = 0;
    frenzyTimer = 0;
    freezeTimer = 0;
    timeLeft = CONFIG.ROUND_TIME;
    scene = SCENE.PLAYING;
    resize();
    UI.show('hud');
  }

  // Idle (menu) state — canvas keeps rendering the blade/background while
  // a DOM overlay (verify, home, locked, wallet) is shown by main.js.
  function idle() {
    scene = SCENE.HOME;
    foods = [];
    halves = [];
    particles = [];
    popups = [];
    resize(); // menus follow natural (portrait) orientation
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

    // WIN = SURVIVED THE FULL ROUND (ADR 0004). Previously this function was
    // reached identically by the timer expiring and by losing every life, and
    // the caller decided "won" from the score — so dying to bombs with a high
    // score reported a win. The outcome is now derived from the actual round
    // state before anything is submitted.
    const outcome = Mechanics.resolveOutcome({
      livesRemaining: lives,
      timeLeftSec: timeLeft,
    });
    const survived = Mechanics.isWin(outcome);

    if (survived) Sound.reward();
    else Sound.gameover();

    // The server re-derives eligibility and is the only authority on rewards;
    // `survived` here is a claim to be validated, never a permission.
    const result = await LoyaltyData.submitRun(score, Math.round(elapsed * 1000), {
      outcome,
      survived,
      livesRemaining: lives,
      bestCombo,
      itemsSliced: totalSlices,
    });

    if (result.won) {
      setTimeout(() => Sound.reward(), 300);
      UI.showChooser(score, result);
    } else {
      UI.showTryAgain(score, result.gap, LoyaltyData.getPlaysLeft(), result.newHigh);
    }
  }

  function goHome() {
    scene = SCENE.HOME;
    foods = [];
    halves = [];
    particles = [];
    popups = [];
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

  return {
    init,
    SCENE,
    startGame,
    idle,
    pauseGame,
    resumeGame,
    endGame,
    goHome,
    finishLoading,
    getScene: () => scene,
  };
})();

// Expose for ES module consumers (top-level const does not attach to window).
window.Game = Game;
