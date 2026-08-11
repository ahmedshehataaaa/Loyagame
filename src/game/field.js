/* ============================================================
   Playfield bounds.

   The engine draws a fixed virtual field (CONFIG.WIDTH × HEIGHT) scaled to
   the viewport with COVER, not contain (ADR 0006) — `Math.max` of the two
   ratios, so the field always fills the screen and the overflow is clipped.

   The consequence, which is subtle and shipped: on a phone taller than the
   field's aspect ratio, the scale is driven by HEIGHT, and the field is
   therefore WIDER than the viewport. A strip down each side of the virtual
   field is simply not on screen.

   Spawn margins were fixed fractions of the virtual width and knew nothing
   about that crop, so items launched into the cropped strips and appeared
   to fly off the left and right edges. Measured on the supported matrix:
   32-40px of every edge-most item was outside the visible area on 360×800,
   390×844, 412×915 and 430×932 — four of six viewports.

   These helpers are pure so the geometry can be proved without a canvas.
   ============================================================ */

/**
 * The slice of the virtual field actually visible, in virtual-x fractions.
 *
 * @param {object} o
 * @param {number} o.viewportW  CSS px
 * @param {number} o.viewportH  CSS px
 * @param {number} o.fieldW     virtual units (CONFIG.WIDTH)
 * @param {number} o.fieldH     virtual units (CONFIG.HEIGHT)
 * @returns {{scale:number, minXFrac:number, maxXFrac:number, minYFrac:number, maxYFrac:number}}
 */
export function visibleVirtualRange({ viewportW, viewportH, fieldW, fieldH }) {
  if (!(viewportW > 0) || !(viewportH > 0) || !(fieldW > 0) || !(fieldH > 0)) {
    // Degenerate input (a zero-size canvas during teardown) must not produce
    // NaN bounds that then poison every spawn.
    return { scale: 1, minXFrac: 0, maxXFrac: 1, minYFrac: 0, maxYFrac: 1 };
  }

  const scale = Math.max(viewportW / fieldW, viewportH / fieldH);
  const offX = (viewportW - fieldW * scale) / 2;
  const offY = (viewportH - fieldH * scale) / 2;

  const minXFrac = -offX / scale / fieldW;
  const maxXFrac = (viewportW - offX) / scale / fieldW;
  const minYFrac = -offY / scale / fieldH;
  const maxYFrac = (viewportH - offY) / scale / fieldH;

  return {
    scale,
    minXFrac: Math.max(0, minXFrac),
    maxXFrac: Math.min(1, maxXFrac),
    minYFrac: Math.max(0, minYFrac),
    maxYFrac: Math.min(1, maxYFrac),
  };
}

/**
 * The x-range items may occupy so that a full sprite stays on screen.
 *
 * Insets the visible range by the largest item radius, so an item centred on
 * the boundary is still wholly visible rather than half cut off — which is
 * what the player actually notices.
 *
 * Falls back to a centred band if the viewport is so narrow that the inset
 * would invert. Better a tighter play area than spawns outside it.
 *
 * @param {object} o
 * @param {number} o.minXFrac      from visibleVirtualRange
 * @param {number} o.maxXFrac      from visibleVirtualRange
 * @param {number} o.radiusFrac    largest item radius, as a fraction of fieldW
 * @param {number} [o.breathFrac]  extra inset so items never graze the edge
 * @returns {{minFrac:number, maxFrac:number}}
 */
export function safeSpawnBounds({ minXFrac, maxXFrac, radiusFrac, breathFrac = 0.02 }) {
  const inset = Math.max(0, radiusFrac) + Math.max(0, breathFrac);
  let min = minXFrac + inset;
  let max = maxXFrac - inset;

  if (min >= max) {
    // Not enough room for a full sprite: centre a minimal band instead of
    // emitting an inverted range that would produce NaN corridors.
    const mid = (minXFrac + maxXFrac) / 2;
    const half = Math.max(0.01, (maxXFrac - minXFrac) / 4);
    min = mid - half;
    max = mid + half;
  }
  return { minFrac: min, maxFrac: max };
}

/**
 * Is a whole item at `xFrac` on screen?
 * Used by tests, and cheap enough to assert with in development.
 */
export function isFullyVisible(xFrac, radiusFrac, { minXFrac, maxXFrac }) {
  return xFrac - radiusFrac >= minXFrac - 1e-9 && xFrac + radiusFrac <= maxXFrac + 1e-9;
}

/**
 * The apex band that keeps the TOP of an item inside the visible field.
 *
 * The mirror image of the x problem, and it bites on the opposite shape of
 * screen. When the viewport is WIDER than the field's aspect ratio — any
 * desktop window, and the `?play` device-gate bypass is exactly that — COVER
 * scaling is driven by width, so the field is TALLER than the viewport and a
 * strip is cropped off the top and bottom. `apexMax: 0.74` then throws items
 * clean through the top edge.
 *
 * The geometry is unusually clean, and it is worth writing down because it
 * looks wrong at first glance: an item launches at `y = H + r` and rises
 * `H * apexFrac`, so its topmost CENTRE is `H + r - H*apexFrac` and its
 * topmost EDGE is `H + r - H*apexFrac - r` = **`H * (1 - apexFrac)`**. The
 * radius cancels exactly. So the sprite's highest point, as a fraction of the
 * field, is simply `1 - apexFrac` — no radius term, whatever the sprite size.
 *
 * Which makes the constraint `1 - apexFrac >= minYFrac + breath`, i.e.
 * `apexFrac <= 1 - minYFrac - breath`.
 *
 * @param {object} o
 * @param {number} o.minYFrac      from visibleVirtualRange — the cropped top
 * @param {number} o.apexMin       configured band, fraction of fieldH
 * @param {number} o.apexMax
 * @param {number} [o.breathFrac]  extra clearance so items never graze the edge
 * @returns {{apexMin:number, apexMax:number}}
 */
export function safeApexBand({ minYFrac, apexMin, apexMax, breathFrac = 0.02 }) {
  const ceiling = 1 - Math.max(0, minYFrac) - Math.max(0, breathFrac);

  // Nothing cropped (any portrait phone): the configured band already fits.
  if (apexMax <= ceiling) return { apexMin, apexMax };

  const max = Math.max(0, ceiling);

  /* The whole band is above the ceiling — a very wide, very short window.
     Keep a band rather than collapsing to a single height, so waves still
     vary, and floor it so items rise far enough to be sliceable at all. An
     arc that never clears the bottom of the visible strip is worse than one
     that grazes the top. */
  const FLOOR = 0.25;
  if (max <= apexMin) {
    const lo = Math.max(FLOOR, max * 0.72);
    return { apexMin: Math.min(lo, max), apexMax: Math.max(lo, max) };
  }

  return { apexMin, apexMax: max };
}
