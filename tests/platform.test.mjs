// Spiral Drop — platform adapter tests: src/platform.js over the shipped
// StarHermit SDK with a stubbed fetch and launch fragment (token read/strip,
// profile nickname, cloud-save round-trip on game:<slug>, settings KV patch,
// key bindings, read-only board, sign-out) plus a standalone run that makes
// no platform call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sdkModule = { exports: {} };
new Function('module', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule);
const SDK = sdkModule.exports;

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const SLUG = 'spiral-drop-test';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = b64u({ alg: 'none' }) + '.' + b64u({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';

function res(status, body) {
  const bytes = body instanceof Uint8Array ? body : null;
  const text = bytes || body == null ? '' : JSON.stringify(body);
  return {
    status, ok: status >= 200 && status < 300, statusText: String(status), headers: { get: () => null },
    text: async () => text, json: async () => JSON.parse(text),
    arrayBuffer: async () => (bytes || Buffer.from(text)).slice().buffer,
  };
}
function win(hash, hostname = 'localhost') {
  return {
    location: { hash, search: '', pathname: '/', hostname, href: 'http://' + hostname + '/' + hash },
    history: { state: null, replaceState(_s, _t, url) { this.last = url; } },
  };
}

test('hosted: token, profile, cloud save, settings, controls, board, sign-out', async () => {
  const calls = [];
  let save = null;
  const kv = { muted: true };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET', path = url.split('?')[0];
    calls.push({ url, method, auth: init.headers.Authorization, keepalive: init.keepalive });
    if (path === `/api/v1/users/${USER}/profile`) return res(200, { username: 'spin_u', nickname: 'Spinner' });
    if (path === '/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG)) {
      if (method === 'PUT') { save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return res(200, { etag: '"v' + calls.length + '"' }); }
      return save ? res(200, new Uint8Array(save)) : res(404);
    }
    if (path === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(kv, JSON.parse(init.body).settings);
      return res(200, { settings: kv });
    }
    if (path === `/api/v1/games/${SLUG}/controls`) return res(200, { actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    if (path === `/api/v1/games/${SLUG}/leaderboards`) return res(200, [{ id: 'lb', key: 'daily' }]);
    if (path === '/api/v1/leaderboards/lb/entries') return res(200, { items: [{ userId: USER, score: 321, rank: 1 }] });
    return res(404);
  };
  const w = win('#game_token=' + TOKEN);
  globalThis.StarHermit = SDK.create({ window: w, fetch, setTimeout: () => 0, clearTimeout() {} });
  const { createPlatform } = await import('../src/platform.js?hosted');
  const p = createPlatform();
  assert.equal(await p.init(), true);
  assert.equal(w.history.last, '/', 'token stripped');
  assert.equal(p.authenticated, true);
  assert.equal(p.scope, SLUG);
  assert.equal(p.playerName, 'Spinner');
  assert.equal(p.cloudDoc, null, 'empty slot');
  assert.equal(p.actionFor('KeyJ'), 'hint', 'control override');
  assert.equal(p.actionFor('KeyH'), null);
  assert.equal(p.actionFor('KeyA'), 'left');
  assert.equal(p.keyLabel('pause'), 'Esc / Space');

  p.cloudSave({ settings: { music: 0.3 }, progress: { nextStage: 4 } });
  assert.equal(p.syncState, 'saving');
  await p.flushCloudSave();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/cloud-saves/game%3A' + SLUG), 'slot game:<slug>');
  assert.equal(put.keepalive, true);
  assert.equal(p.syncState, 'synced');
  assert.deepEqual((await globalThis.StarHermit.loadJSON()).progress, { nextStage: 4 }, 'cloud round-trip');

  assert.deepEqual(await p.loadSettings(), { muted: true });
  p.pushSettings({ largeText: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(kv.largeText, true, 'settings PATCH');

  assert.deepEqual(await p.leaderboard('daily-x', false), { entries: [{ name: 'Spinner', score: 321 }] });
  assert.ok(calls.every((c) => c.auth === 'Bearer ' + TOKEN), 'Bearer on every call');
  assert.ok(!calls.some((c) => c.url === '/api/v1/me'));

  assert.ok(p.inviteLink().endsWith(`/game-invite/${USER}/${SLUG}`));
  assert.equal(p.canSignIn(), false);
  let out = 0;
  p.onSignedOut(() => out++);
  globalThis.StarHermit.signOut('expired');
  assert.equal(out, 1);
  assert.equal(p.authenticated, false);
  assert.equal(p.inviteLink(), null);
});

test('standalone: no network at all (no own-server probes)', async () => {
  const sdkCalls = [];
  globalThis.StarHermit = SDK.create({ window: win(''), fetch: async (u) => { sdkCalls.push(u); return res(500); } });
  const probes = [];
  globalThis.fetch = async (u) => { probes.push(u); throw new Error('offline'); };
  const { createPlatform } = await import('../src/platform.js?standalone');
  const p = createPlatform();
  assert.equal(await p.init(), false);
  assert.equal(p.authenticated, false);
  p.cloudSave({});
  await p.flushCloudSave();
  assert.deepEqual(await p.loadSettings(), {});
  p.pushSettings({ muted: true });
  assert.deepEqual(await p.leaderboard('x', false), { entries: [] });
  assert.deepEqual(await p.submitScore(900), { posted: false, rank: null });
  assert.equal(p.canSignIn(), false);
  assert.equal(p.actionFor('Space'), 'pause');
  assert.equal(sdkCalls.length, 0, 'no SDK/platform fetch');
  assert.deepEqual(probes, [], 'no own-server calls');
  assert.ok(Math.abs(p.now().getTime() - Date.now()) < 1000, 'local clock');
  delete globalThis.fetch;
});

test('on <id>.starhermit.com without a token: sign-in offered', async () => {
  // canSignIn() is only true on a game's UUID host (<uuid>.starhermit.com).
  globalThis.StarHermit = SDK.create({ window: win('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com'), fetch: async () => res(500) });
  const { createPlatform } = await import('../src/platform.js?onplatform');
  assert.equal(createPlatform().canSignIn(), true);
});

test('hosted: submitScore posts high-score and reads the rank', async () => {
  globalThis.StarHermit = SDK.create({ window: win('#game_token=' + TOKEN), fetch: async () => res(404), setTimeout: () => 0, clearTimeout() {} });
  globalThis.StarHermit.init();
  const { createPlatform } = await import('../src/platform.js?submit');
  const p = createPlatform();
  const sent = [];
  globalThis.StarHermit.submitScores = async (sc) => { sent.push(sc); return Object.keys(sc); };
  globalThis.StarHermit.leaderboard = async (key) => ({ items: key === 'high-score' ? [{ userId: USER, rank: 6 }] : [] });
  assert.deepEqual(await p.submitScore(2210.2), { posted: true, rank: 6 });
  assert.deepEqual(sent, [{ 'high-score': 2210 }]);
  globalThis.StarHermit.submitScores = async () => [];
  assert.deepEqual(await p.submitScore(5), { posted: false, rank: null });
});

test('leaderboard line strings in every locale', async () => {
  const { SH_STRINGS } = await import('../src/sh-strings.js');
  assert.equal(Object.keys(SH_STRINGS).length, 9);
  for (const [l, t] of Object.entries(SH_STRINGS)) {
    for (const k of ['lbPosting', 'lbRank', 'lbPosted', 'lbNotPosted']) assert.ok(t[k], l + ' ' + k);
    assert.ok(t.lbRank.includes('{rank}'));
  }
});

test('mergeProgress keeps the better side of every field', async () => {
  const { mergeProgress } = await import('../src/platform.js?merge');
  const m = mergeProgress(
    { stages: { j01: { stars: 2, score: 900 }, j02: { stars: 1, score: 400 } }, lessons: { l1: true }, achievements: { first_clear: 20 },
      lifetimeLayers: 120, dailyStreak: { last: '2026-10-02', count: 2 }, bestScores: { j01: 900 }, nextStage: 2 },
    { stages: { j01: { stars: 3, score: 700 } }, lessons: { l2: true }, achievements: { first_clear: 10, combo_master: 30 },
      lifetimeLayers: 90, dailyStreak: { last: '2026-10-01', count: 5 }, bestScores: { j01: 700, 'c-moves': 300 }, nextStage: 1 });
  assert.deepEqual(m.stages, { j01: { stars: 3, score: 900 }, j02: { stars: 1, score: 400 } });
  assert.deepEqual(m.lessons, { l1: true, l2: true });
  assert.deepEqual(m.achievements, { first_clear: 10, combo_master: 30 });
  assert.equal(m.lifetimeLayers, 120);
  assert.deepEqual(m.dailyStreak, { last: '2026-10-02', count: 2 });
  assert.deepEqual(m.bestScores, { j01: 900, 'c-moves': 300 });
  assert.equal(m.nextStage, 2);
});

test('save conflict: another device saved first → reload and hand the doc to the game', async () => {
  const slot = '/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG);
  const zipOf = async (doc) => {
    let bytes = null;
    const z = SDK.create({ window: win('#game_token=' + TOKEN), fetch: async (u, init = {}) => {
      if (init.method === 'PUT') { bytes = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return res(200, { etag: '"z"' }); }
      return res(404);
    }, setTimeout: () => 0, clearTimeout() {} });
    z.init();
    await z.writeSave(JSON.stringify(doc));
    return bytes;
  };
  let stored = null, etag = null;
  const puts = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET', path = url.split('?')[0];
    if (path === slot + '/info') return res(200, { exists: !!stored, etag });
    if (path === slot && method === 'GET') return res(200, new Uint8Array(stored));
    if (path === slot && method === 'PUT') {
      const match = init.headers['If-Match'];
      puts.push(match || init.headers['If-None-Match']);
      if ((match && match !== etag) || (!match && stored)) return res(412, { error: 'precondition_failed' });
      stored = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
      etag = '"v' + puts.length + '"';
      return res(200, { etag });
    }
    if (path.endsWith('/profile')) return res(200, { nickname: 'Spinner' });
    return res(404);
  };
  globalThis.StarHermit = SDK.create({ window: win('#game_token=' + TOKEN), fetch, setTimeout: () => 0, clearTimeout() {} });
  const { createPlatform, mergeProgress } = await import('../src/platform.js?conflict');
  const p = createPlatform();
  await p.init();
  let progress = { stages: { j01: { stars: 1, score: 100 } } };
  const merged = new Promise((resolve) => p.onConflict((doc) => {
    progress = mergeProgress(doc && doc.progress, progress);
    p.cloudSave({ progress });
    resolve();
  }));
  stored = await zipOf({ progress: { stages: { j05: { stars: 2, score: 500 } } } });
  etag = '"other"';
  p.cloudSave({ progress });
  await p.flushCloudSave();
  await merged;
  assert.deepEqual(Object.keys(progress.stages).sort(), ['j01', 'j05'], 'both devices kept');
  assert.equal(globalThis.StarHermit.saveConflicted(), false);
  await p.flushCloudSave();
  assert.equal(puts.at(-1), '"other"', 'the merge is written on top of the reloaded version');
  assert.equal(p.syncState, 'synced');
});
