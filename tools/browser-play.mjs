// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). Real time runs on the page's
// clock here, so the runs use stages without danger sectors, where any
// steady turning reaches the base: on the desktop Journey stage 1 by a held
// arrow key, then stage 2 after a pause by Escape; on the phone lesson 2 by a
// finger held on the round rotate button, then a retry turned by finger
// drags across the tower and paused by the pause button; sideways Journey
// stage 1 by a finger on the other rotate button, then the Scores screen.
// Widgets are found through the page's accessibility mirror of the engine's
// UI. Screenshots of each step go to --shots. Fails on console errors or
// warnings, the runtime's error screen, or a view that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000);
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const find = (name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('checkbox', { name, exact: true })).or(page.getByText(name, { exact: true })).first();
  /** A tap / click at window coordinates (CSS px). */
  const tapAt = async (x, y) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  /** A press on a widget (or a table target): the mouse on the desktop, a finger on the phones. */
  const press = async (name) => {
    const el = find(name);
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  let reached = false;
  const results = async () => { await page.getByText('Score breakdown', { exact: true }).first().waitFor({ timeout: 90000 }); await page.waitForTimeout(800); };
  const active = async () => { await page.getByText(/^Layer \d+ \/ \d+$/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(4500); };
  /** A finger held on a widget until `until` resolves. */
  const holdFinger = async (name, until) => {
    const el = find(name);
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }] });
    try { await until(); } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  };
  try {
    await shot('title');
    if (v.name === 'desktop') {
      await press('▶ Play — start the Journey');
      await press('Start');
      await active();
      await shot('journey-1');
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(500);
      await shot('journey-1-turning');
      await results().finally(() => page.keyboard.up('ArrowRight'));
      await shot('journey-1-results');
      await press('Next: Steady Hand');
      await active();
      await page.keyboard.press('Escape');
      await find('Resume').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await shot('pause');
      await press('Resume');
      await page.waitForTimeout(500);
      await page.keyboard.down('ArrowLeft');
      await results().finally(() => page.keyboard.up('ArrowLeft'));
      await shot('journey-2-results');
    } else if (v.name === 'phone') {
      await press('Learn to Play');
      await press('2. Find the Gap');
      await press('Start');
      await active();
      await shot('lesson-2');
      await holdFinger('Rotate tower right', results);
      await shot('lesson-2-results');
      await press('Retry');
      await active();
      // finger drags sideways across the tower turn it
      const w = v.viewport.width, y = v.viewport.height * 0.55;
      let done = false;
      for (let i = 0; i < 60 && !done; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w * 0.2, y, id: 1 }] });
        for (let k = 1; k <= 12; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: w * (0.2 + 0.05 * k), y, id: 1 }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        if (i === 2) await shot('lesson-2-drag');
        done = (await page.getByText(/^Layer [1-9]/).count()) > 0;
      }
      if (!done) throw new Error('drags did not turn the tower');
      {
        await page.waitForTimeout(1500); // a tap right after a drag's end is not a press (as a player lifts and taps again)
        const b = await page.getByRole('button', { name: 'Pause (Esc)', exact: true }).first().boundingBox();
        await tapAt(b.x + b.width / 2, b.y + b.height / 2);
      }
      await find('Resume').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await shot('pause');
      await press('Leave round');
    } else {
      await press('Journey');
      await press('Stage 1 First Drop');
      await press('Start');
      await active();
      await shot('journey-1');
      await holdFinger('Rotate tower left', results);
      await shot('journey-1-results');
      await press('← Menu');
      await press('Scores');
      await page.waitForTimeout(800);
      await shot('scores');
    }
    reached = true;
  } catch (e) {
    problems.push(`play: ${String(e.message || e).split('\n')[0]}`);
    await shot('failed');
    const names = await page.locator('button, [role=button]').evaluateAll((els) => els.map((x) => x.getAttribute('aria-label') || x.textContent)).catch(() => []);
    problems.push(`buttons: ${names.join(' | ')}`);
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && reached;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} played=${reached}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
