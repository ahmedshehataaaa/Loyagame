/* Shared e2e helper: get past the Spin to Win reveal.
 *
 * A survived round no longer navigates straight to the Result screen — it
 * reveals the server's decision through the wheel first (ADR 0016). Specs that
 * are about the RESULT screen therefore have to pass through the reveal.
 *
 * This lives in its own module rather than being copied into each spec because
 * its correctness is all in the waiting: the `close` button does not exist until
 * the reveal has settled, so clicking it is what waits out the animation. Three
 * copies of that would drift.
 *
 * Not a `*.spec.js`, so Playwright's default testMatch ignores it.
 */
import { expect } from '@playwright/test';

/**
 * Spin, then close — leaving the player (and the test) on `#/result`.
 *
 * Buttons are addressed by `data-act`, never by label, so this works unchanged
 * in Arabic. The wheel's own behaviour — ordering, landing, denial copy — is
 * covered by spin-wheel.spec.js; here it is only traversed.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function revealThroughWheel(page) {
  const overlay = page.locator('.spin-overlay');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('[data-act="spin"]').click();
  await overlay.locator('[data-act="close"]').click();
  await expect(overlay).toHaveCount(0);
}
