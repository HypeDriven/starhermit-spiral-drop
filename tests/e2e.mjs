/**
 * Spiral Drop — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play (Journey stage 1) → countdown → actively rotate the tower
 *   with the arrow-key controls so the ball actually threads each ring's gap
 *   and reaches the base → results ("Base Reached!") with score breakdown +
 *   persisted journey progress. Also exercises pause/resume (Esc + the Resume
 *   button) mid-run. A second pass runs the load → start → rotate-a-few-
 *   layers + a real on-screen rotate-button tap flow on a mobile touch
 *   viewport.
 *
 * The game exposes its rules engine as window.SpiralRules and its live
 * session as window.SpiralDrop.session (main.js). The test reads that state
 * ONLY as a read-only observation oracle to choose WHICH direction to press
 * next (the same gapAlignment data the on-screen buttons and the Hint button
 * use) and to wait/measure; every action is a real key press / click / tap on
 * a visible control. No game code is modified.
 *
 * Serving: the repo ships `server.js` (the StarHermit authoritative script
 * declared by starhermit.txt). The game is fully playable offline — when
 * `/api/v1/time` is unavailable the platform sets `hosted=false` and every
 * local mode (journey, practice, learn, results) works without the backend.
 * So, per the sibling-test convention (blockstead/balance-spire/picture-logic),
 * this test embeds a minimal node:http static server on an ephemeral port and
 * answers /api/* with 404 so the client degrades to its documented offline
 * path. If the UI ever starts requiring the real backend this can be swapped
 * for spawning `server.js`; today it is not needed.
 *
 * Note: webgl is exercised via swiftshader (`--enable-unsafe-swiftshader`);
 * benign software-GPU console lines are filtered (see browserNoise below).
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/spiral-drop-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: 404 /api/* so the platform adapter (init →
    // syncTime) degrades to documented offline mode (hosted=false) without
    // hanging. The 404 is benign and filtered by the console/response hooks.
    if (p.startsWith('/api/')) { res.writeHead(404).end('not found'); return; }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- read-only observation oracle ----------
// Read the live session/rules state via the game's own exposed handles.
// Used only to (a) know when the countdown/round is active, (b) read the
// ball's current layer, and (c) choose the rotation DIRECTION to press that
// moves the next ring's gap toward the ball (the same gapAlignment surface the
// on-screen ⟲/⟳ buttons and Hint button consume). No move is made here.
async function readPlay(page) {
  return page.evaluate(() => {
    const SP = window.SpiralDrop;
    const ses = SP && SP.session;
    const s = ses && ses.state;
    if (!s) return { ok: false, sessionPhase: ses && ses.phase };
    const next = s.ball.layer + 1;
    let clear = false, want = 0;
    if (s.phase === 'rest' && next < s.config.layers.length) {
      const al = window.SpiralRules.gapAlignment(s, next);
      clear = al.clear;
      want = al.delta > 0 ? -1 : 1; // tower rotation that closes the gap in on the ball
    }
    return {
      ok: true,
      sessionPhase: ses.phase,
      rulesPhase: s.phase,
      layer: s.ball.layer,
      layers: s.config.layers.length,
      clear, want,
      terminal: s.phase === 'terminal',
      reason: s.terminal ? s.terminal.reason : null,
      rotating: s.rotating,
      score: window.SpiralRules.totalScore(s),
    };
  });
}

// Real arrow-key rotation: press a direction to start turning (the game's
// documented ←/→ / A/D controls) and release to stop. The tower spins at the
// rules ROT_SPEED while a key is held; we stop as soon as the next ring's gap
// is under the ball, then let the ball fall through. Landing on a ring just
// returns to 'rest' and we align the next gap — no dangers exist on Journey
// tier-1, so this always reaches the base.
async function drive(page, { steps, stopAtLayer, maxMs }) {
  let held = 0;
  const setHeld = async (dir) => {
    if (dir === held) return;
    if (held === -1) await page.keyboard.up('ArrowLeft');
    if (held === 1) await page.keyboard.up('ArrowRight');
    held = 0;
    if (dir === -1) await page.keyboard.down('ArrowLeft');
    if (dir === 1) await page.keyboard.down('ArrowRight');
    held = dir;
  };
  const t0 = Date.now();
  try {
    for (let i = 0; i < steps; i++) {
      const st = await readPlay(page);
      if (!st.ok) { await setHeld(0); await sleep(60); continue; }
      if (st.terminal) break;
      if (st.sessionPhase !== 'active') { await setHeld(0); await sleep(60); continue; }
      // Only turn while the ball is resting on a ring; freeze it during the
      // fall/land-resolve so the crossing legality stays put.
      if (st.rulesPhase === 'rest') await setHeld(st.clear ? 0 : st.want);
      else await setHeld(0);
      if (stopAtLayer != null && st.layer >= stopAtLayer) break;
      if (Date.now() - t0 > maxMs) throw new Error('drive did not complete within ' + maxMs + 'ms');
      await sleep(22);
    }
  } finally {
    await setHeld(0);
  }
}

const waitActive = (page) =>
  page.waitForFunction(() => window.SpiralDrop?.session?.phase === 'active', null, { timeout: 15000 });

const resultsPanel = (page) => page.locator('#screens .screen .panel');

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\//.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(u)) errors.push(`http ${r.status()}: ${u}`);
  });

  const click = (sel) => ctxOpts.hasTouch ? page.tap(sel) : page.click(sel);

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#screens .screen .panel', { timeout: 15000 });
    const h1 = (await page.textContent('#screens .screen .panel h1')) || '';
    if (h1.trim() !== 'Spiral Drop') throw new Error(`unexpected title h1 "${h1.trim()}"`);
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible ("${h1.trim()}")`);

    // Play → journey setup → Start
    await click('#screens .screen .panel button.big');
    await page.waitForSelector('#screens .screen .panel');
    const setupH = (await page.textContent('#screens .screen .panel h2')) || '';
    if (!/Stage 1/.test(setupH)) throw new Error(`expected Stage 1 setup, got "${setupH.trim()}"`);
    const startBtn = page.locator('#screens .screen .panel button.big');
    if ((await startBtn.textContent()).trim() !== 'Start') throw new Error('Start button not found');
    await click('#screens .screen .panel button.big');
    await waitActive(page);

    if (await page.locator('#hud').isHidden()) throw new Error('HUD not visible during play');
    const objective = (await page.textContent('#hud-objective')) || '';
    const prog0 = (await page.textContent('#hud-progress')) || '';
    ok(`${name}: journey stage 1 started ("${objective.trim()}", ${prog0.trim()})`);

    if (full) {
      // ---- DESKTOP: play through to a real win, with pause/resume mid-run ----

      // real play: rotate the tower through the arrow-key controls until the
      // ball has genuinely descended a couple of rings
      await drive(page, { steps: 2000, stopAtLayer: 2, maxMs: 120000 });
      const after1 = await readPlay(page);
      if (!after1.ok || after1.layer < 1) throw new Error(`ball did not descend after real play (layer=${after1.layer})`);
      const prog1 = (await page.textContent('#hud-progress')) || '';
      ok(`${name}: rotated & dropped the ball through real controls (layer ${after1.layer}, HUD "${prog1.trim()}")`);
      await page.screenshot({ path: SHOT('play', name) });

      // pause → resume through the visible overlay
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.SpiralDrop?.session?.phase === 'paused', null, { timeout: 8000 });
      const pHead = (await page.textContent('#screens .screen .panel h2')) || '';
      if (pHead.trim() !== 'Paused') throw new Error(`expected Paused overlay, got "${pHead.trim()}"`);
      await page.screenshot({ path: SHOT('pause', name) });
      await click('#screens .screen .panel button.big'); // Resume
      await waitActive(page);
      ok(`${name}: pause (Esc) and Resume work`);

      // finish the run for real
      await drive(page, { steps: 12000, maxMs: 280000 });

      // natural end: results screen
      await page.waitForFunction(() => window.SpiralDrop?.session?.phase === 'results', null, { timeout: 15000 });
      await page.waitForSelector('#screens .screen .panel h2', { timeout: 8000 });
      const head = (await page.textContent('#screens .screen .panel h2')) || '';
      if (head.trim() !== 'Base Reached!') throw new Error(`run did not win; results headline "${head.trim()}"`);
      const kv = (await resultsPanel(page).locator('.kv').allTextContents()) || [];
      const totalRow = kv.find((t) => t.includes('Total'));
      if (!totalRow) throw new Error('no Total row on results');
      const total = Number((totalRow.match(/\d+/) || [0])[0]);
      if (!(total > 0)) throw new Error(`expected positive total score, got ${total}`);
      // The "Run" section's Layers row looks like "Layers descended<N> / <Total>".
      let layersDone = -1, layersTotal = -1;
      for (const t of kv) {
        const m = t.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) { layersDone = Number(m[1]); layersTotal = Number(m[2]); break; }
      }
      if (layersDone !== layersTotal || layersTotal <= 0) {
        throw new Error(`not all layers descended: ${layersDone}/${layersTotal}`);
      }
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: reached the base — results shown ("${head.trim()}", total ${total}, ${layersDone}/${layersTotal} layers)`);

      // progression persisted (journey stage 1 cleared)
      const progressDoc = await page.evaluate(() => {
        const raw = localStorage.getItem('spiraldrop.progress.v1');
        return raw ? JSON.parse(raw).data : null;
      });
      if (!progressDoc?.stages?.j01 || !(progressDoc.stages.j01.stars > 0)) {
        throw new Error('journey stage 1 completion not persisted: ' + JSON.stringify(progressDoc));
      }
      ok(`${name}: journey progress persisted (j01 stars: ${progressDoc.stages.j01.stars})`);

      // back to the title via the "Menu" back button
      await click('#screens .screen .panel button.ghost:has-text("Menu")');
      await page.waitForFunction(() => window.SpiralDrop?.session?.phase === 'title', null, { timeout: 8000 });
      await page.waitForSelector('#screens .screen .panel h1');
      ok(`${name}: quit to title`);
    } else {
      // ---- MOBILE: shorter — real play to descent + a real touch tap ----
      await drive(page, { steps: 2000, stopAtLayer: 2, maxMs: 120000 });
      const st = await readPlay(page);
      if (!st.ok || st.layer < 1) throw new Error(`no progression on mobile (layer=${st.layer})`);
      const progM = (await page.textContent('#hud-progress')) || '';
      if (!(st.score > 0)) throw new Error(`expected a positive score, got ${st.score}`);
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: rotated & dropped through real controls (layer ${st.layer}, score ${st.score}, HUD "${progM.trim()}")`);

      // a real touchscreen tap on the on-screen rotate button registers a command
      await sleep(400); // let the previous key-up settle so the touch isn't swallowed
      const before = await page.evaluate(() => window.SpiralDrop.session.state.inputLog.length);
      let grew = false;
      for (let k = 0; k < 4 && !grew; k++) {
        await page.touchscreen.tap(...(await tapCenter(page, '#hud-bottom #btn-rot-right')));
        await sleep(220);
        grew = (await page.evaluate(() => window.SpiralDrop.session.state.inputLog.length)) > before;
      }
      if (!grew) throw new Error(`touch rotate did not register (inputLog stayed ${before})`);
      ok(`${name}: real touchscreen tap on the on-screen rotate button registered`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

async function tapCenter(page, sel) {
  const bb = await page.locator(sel).boundingBox();
  if (!bb) throw new Error(`no bounding box for ${sel}`);
  return [bb.x + bb.width / 2, bb.y + bb.height / 2];
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — spiral-drop, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
