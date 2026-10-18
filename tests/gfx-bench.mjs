// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only, never shipped): picks a preset through the
// real Settings panel, starts the 26-layer Expert practice run and keeps the tower turning with the
// arrow keys so the ball threads gap after gap (rings rebuild, particles burst, camera springs); a run that
// ends (a danger sector) is retried from the results panel.
// Like tests/e2e.mjs it reads the live rules state only to choose which direction to hold.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const panel = '#screens .screen .panel';

export async function setPreset(page, preset) {
  await page.waitForSelector(`${panel} h1`);
  await page.locator(`${panel} button`, { hasText: /^Settings$/ }).click();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.getAttribute('data-gfx-preset') === p, preset);
  await page.locator(`${panel} button`, { hasText: /^← Back$/ }).click();
  await page.waitForSelector(`${panel} h1`);
}

export async function start(page) {
  await page.locator(`${panel} button`, { hasText: /^Practice$/ }).click();
  await page.locator(`${panel} button`, { hasText: /^Expert/ }).click();
  await page.locator(`${panel} button.big`, { hasText: /^Start$/ }).click();
  await page.waitForFunction(() => window.SpiralDrop?.session?.phase === 'active', null, { timeout: 15000 });
  let held = null, busy = false, stopped = false;
  const hold = async (key) => {
    if (key === held) return;
    if (held) await page.keyboard.up(held);
    held = key;
    if (key) await page.keyboard.down(key);
  };
  const timer = setInterval(async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const phase = await page.evaluate(() => window.SpiralDrop?.session?.phase);
      if (phase === 'results') { await hold(null); await page.click(`${panel} button.big`); return; } // Retry / Next stage
      const want = await page.evaluate(() => {
        const s = window.SpiralDrop?.session?.state;
        if (!s || s.phase !== 'rest' || s.ball.layer + 1 >= s.config.layers.length) return 0;
        const al = window.SpiralRules.gapAlignment(s, s.ball.layer + 1);
        return al.clear ? 0 : al.delta > 0 ? -1 : 1;
      });
      await hold(want < 0 ? 'ArrowLeft' : want > 0 ? 'ArrowRight' : null);
    } catch { stopped = true; } finally { busy = false; }
  }, 40);
  page.once('close', () => { stopped = true; clearInterval(timer); });
  await page.waitForTimeout(1500);
}
